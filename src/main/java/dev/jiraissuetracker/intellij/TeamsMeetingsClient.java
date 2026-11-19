package dev.jiraissuetracker.intellij;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.ResourceBundle;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TeamsMeetingsClient {
    private static final ResourceBundle MESSAGES =
            ResourceBundle.getBundle("src");

    private static final String DEFAULT_GRAPH_ENDPOINT =
            "https://graph.microsoft.com/v1.0/me/calendarView";

    private static final DateTimeFormatter ICS_UTC_FORMAT =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'");
    private static final DateTimeFormatter ICS_LOCAL_FORMAT =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");
    private static final DateTimeFormatter ICS_DATE_FORMAT =
            DateTimeFormatter.ofPattern("yyyyMMdd");

    private static final Pattern TEAMS_LINK_PATTERN = Pattern.compile(
            "https://teams\\.(?:microsoft\\.com|live\\.com)/[^\\s\"<>\\\\]+",
            Pattern.CASE_INSENSITIVE
    );

    @FunctionalInterface
    interface Transport {
        String get(String url, Map<String, String> headers) throws Exception;
    }

    static final class MeetingItem {
        final String id;
        final String seriesKey;
        final String title;
        final Instant start;
        final Instant end;
        final int durationMinutes;
        final String durationFormatted;
        final String joinUrl;
        final boolean isTeamsMeeting;
        final String organizer;

        MeetingItem(
                String id,
                String seriesKey,
                String title,
                Instant start,
                Instant end,
                String joinUrl,
                boolean isTeamsMeeting,
                String organizer
        ) {
            this.id = id;
            this.seriesKey = seriesKey;
            this.title = title;
            this.start = start;
            this.end = end.isAfter(start) ? end : start.plus(30, ChronoUnit.MINUTES);
            long minutes = Math.max(1, Duration.between(this.start, this.end).toMinutes());
            this.durationMinutes = (int) minutes;
            this.durationFormatted = formatDuration(this.durationMinutes);
            this.joinUrl = Objects.requireNonNullElse(joinUrl, "");
            this.isTeamsMeeting = isTeamsMeeting || !this.joinUrl.isEmpty();
            this.organizer = Objects.requireNonNullElse(organizer, "");
        }

        JsonObject toJson() {
            JsonObject obj = new JsonObject();
            obj.addProperty("id", id);
            obj.addProperty("seriesKey", seriesKey);
            obj.addProperty("title", title);
            obj.addProperty("start", start.toString());
            obj.addProperty("end", end.toString());
            obj.addProperty("durationMinutes", durationMinutes);
            obj.addProperty("durationFormatted", durationFormatted);
            obj.addProperty("joinUrl", joinUrl);
            obj.addProperty("isTeamsMeeting", isTeamsMeeting);
            obj.addProperty("organizer", organizer);
            return obj;
        }
    }

    private final Transport transport;
    private final Instant windowStart;
    private final Instant windowEnd;

    TeamsMeetingsClient(HttpClient httpClient) {
        this(
                defaultTransport(httpClient),
                Instant.now().minus(12, ChronoUnit.HOURS),
                Instant.now().plus(14, ChronoUnit.DAYS)
        );
    }

    TeamsMeetingsClient(
            Transport transport,
            Instant windowStart,
            Instant windowEnd
    ) {
        this.transport = Objects.requireNonNull(transport);
        this.windowStart = Objects.requireNonNull(windowStart);
        this.windowEnd = Objects.requireNonNull(windowEnd);
    }

    List<MeetingItem> fetchFromIcs(String icsUrl) throws Exception {
        String normalizedUrl = JiraSettings.normalizeIcsUrl(icsUrl);
        if (normalizedUrl.isEmpty()) {
            throw new IllegalArgumentException(
                    MESSAGES.getString("settings.teams.ics.invalid")
            );
        }
        String body = transport.get(
                normalizedUrl,
                Map.of("Accept", "text/calendar, text/plain, */*")
        );
        return parseIcsCalendar(body, windowStart, windowEnd);
    }

    List<MeetingItem> fetchFromGraph(String bearerToken) throws Exception {
        return fetchFromGraph(DEFAULT_GRAPH_ENDPOINT, bearerToken);
    }

    List<MeetingItem> fetchFromGraph(
            String graphEndpoint,
            String bearerToken
    ) throws Exception {
        String token = Objects.requireNonNullElse(bearerToken, "").trim();
        if (token.isEmpty()) {
            throw new IllegalArgumentException(
                    MESSAGES.getString("settings.teams.token.required")
            );
        }
        String separator = graphEndpoint.contains("?") ? "&" : "?";
        String queryUrl = graphEndpoint
                + separator
                + "startDateTime="
                + URLEncoder.encode(windowStart.toString(), StandardCharsets.UTF_8)
                + "&endDateTime="
                + URLEncoder.encode(windowEnd.toString(), StandardCharsets.UTF_8)
                + "&$orderby=start/dateTime&$top=50";

        String response = transport.get(
                queryUrl,
                Map.of(
                        "Authorization", "Bearer " + token,
                        "Accept", "application/json",
                        "Prefer", "outlook.timezone=\"UTC\""
                )
        );
        return parseGraphCalendar(response, windowStart, windowEnd);
    }

    static List<MeetingItem> parseGraphCalendar(
            String jsonText,
            Instant windowStart,
            Instant windowEnd
    ) {
        JsonObject root = JsonParser.parseString(jsonText).getAsJsonObject();
        JsonArray values = root.has("value") && root.get("value").isJsonArray()
                ? root.getAsJsonArray("value")
                : new JsonArray();

        List<MeetingItem> meetings = new ArrayList<>();
        for (JsonElement element : values) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject item = element.getAsJsonObject();
            if (item.has("isCancelled")
                    && !item.get("isCancelled").isJsonNull()
                    && item.get("isCancelled").getAsBoolean()) {
                continue;
            }

            String id = getString(item, "id");
            String title = getString(item, "subject");
            if (title.isEmpty()) {
                title = "(No title)";
            }
            String seriesMasterId = getString(item, "seriesMasterId");
            String seriesKey = !seriesMasterId.isEmpty()
                    ? seriesMasterId
                    : normalizeSeriesKey(title);

            Instant start = parseGraphDateTime(
                    item.has("start") && item.get("start").isJsonObject()
                            ? item.getAsJsonObject("start")
                            : null
            );
            Instant end = parseGraphDateTime(
                    item.has("end") && item.get("end").isJsonObject()
                            ? item.getAsJsonObject("end")
                            : null
            );
            if (start == null) {
                continue;
            }
            if (end == null) {
                end = start.plus(30, ChronoUnit.MINUTES);
            }
            if (end.isBefore(windowStart) || start.isAfter(windowEnd)) {
                continue;
            }

            String joinUrl = "";
            if (item.has("onlineMeeting") && item.get("onlineMeeting").isJsonObject()) {
                joinUrl = getString(item.getAsJsonObject("onlineMeeting"), "joinUrl");
            }
            if (joinUrl.isEmpty()) {
                joinUrl = getString(item, "onlineMeetingUrl");
            }
            boolean isOnline = (item.has("isOnlineMeeting")
                    && !item.get("isOnlineMeeting").isJsonNull()
                    && item.get("isOnlineMeeting").getAsBoolean())
                    || !joinUrl.isEmpty();

            String organizer = "";
            if (item.has("organizer") && item.get("organizer").isJsonObject()) {
                JsonObject orgObj = item.getAsJsonObject("organizer");
                if (orgObj.has("emailAddress") && orgObj.get("emailAddress").isJsonObject()) {
                    organizer = getString(orgObj.getAsJsonObject("emailAddress"), "name");
                }
            }

            meetings.add(new MeetingItem(
                    id.isEmpty() ? seriesKey + "@" + start : id,
                    seriesKey,
                    title,
                    start,
                    end,
                    joinUrl,
                    isOnline,
                    organizer
            ));
        }

        meetings.sort(Comparator.comparing(m -> m.start));
        return meetings;
    }

    static List<MeetingItem> parseIcsCalendar(
            String icsText,
            Instant windowStart,
            Instant windowEnd
    ) {
        List<String> unfolded = unfoldIcsLines(icsText);
        List<MeetingItem> meetings = new ArrayList<>();

        boolean inEvent = false;
        Map<String, String> props = new HashMap<>();
        Map<String, String> params = new HashMap<>();

        for (String line : unfolded) {
            String trimmed = line.trim();
            if (trimmed.equalsIgnoreCase("BEGIN:VEVENT")) {
                inEvent = true;
                props.clear();
                params.clear();
                continue;
            }
            if (trimmed.equalsIgnoreCase("END:VEVENT")) {
                if (inEvent) {
                    meetings.addAll(buildIcsEventInstances(props, params, windowStart, windowEnd));
                }
                inEvent = false;
                continue;
            }
            if (!inEvent) {
                continue;
            }
            int colon = line.indexOf(':');
            if (colon <= 0) {
                continue;
            }
            String rawKey = line.substring(0, colon).trim();
            String rawValue = line.substring(colon + 1);
            int semi = rawKey.indexOf(';');
            String propName = (semi >= 0 ? rawKey.substring(0, semi) : rawKey)
                    .toUpperCase(Locale.ROOT);
            String paramPart = semi >= 0 ? rawKey.substring(semi + 1) : "";
            props.put(propName, rawValue);
            params.put(propName, paramPart);
        }

        meetings.sort(Comparator.comparing(m -> m.start));
        return meetings;
    }

    private static List<MeetingItem> buildIcsEventInstances(
            Map<String, String> props,
            Map<String, String> params,
            Instant windowStart,
            Instant windowEnd
    ) {
        String status = props.getOrDefault("STATUS", "");
        if ("CANCELLED".equalsIgnoreCase(status.trim())) {
            return List.of();
        }

        String dtStartRaw = props.get("DTSTART");
        if (dtStartRaw == null || dtStartRaw.isBlank()) {
            return List.of();
        }

        ZoneId startZone = resolveTimeZone(params.getOrDefault("DTSTART", ""));
        Instant baseStart = parseIcsDateTime(dtStartRaw.trim(), startZone);
        if (baseStart == null) {
            return List.of();
        }

        Instant baseEnd = null;
        String dtEndRaw = props.get("DTEND");
        if (dtEndRaw != null && !dtEndRaw.isBlank()) {
            ZoneId endZone = resolveTimeZone(params.getOrDefault("DTEND", ""));
            baseEnd = parseIcsDateTime(dtEndRaw.trim(), endZone);
        }
        if (baseEnd == null || !baseEnd.isAfter(baseStart)) {
            baseEnd = baseStart.plus(30, ChronoUnit.MINUTES);
        }

        Duration eventDuration = Duration.between(baseStart, baseEnd);
        String summary = unescapeIcsText(props.getOrDefault("SUMMARY", "(No title)")).trim();
        if (summary.isEmpty()) {
            summary = "(No title)";
        }
        String uid = props.getOrDefault("UID", "").trim();
        String seriesKey = normalizeSeriesKey(summary);
        if (seriesKey.isEmpty()) {
            seriesKey = !uid.isEmpty() ? uid : "meeting";
        }

        String description = unescapeIcsText(props.getOrDefault("DESCRIPTION", ""));
        String location = unescapeIcsText(props.getOrDefault("LOCATION", ""));
        String joinUrl = extractTeamsLink(location + "\n" + description);
        boolean isTeams = !joinUrl.isEmpty()
                || location.toLowerCase(Locale.ROOT).contains("microsoft teams")
                || description.toLowerCase(Locale.ROOT).contains("microsoft teams");

        String organizer = extractOrganizerName(
                params.getOrDefault("ORGANIZER", ""),
                props.getOrDefault("ORGANIZER", "")
        );

        String rrule = props.getOrDefault("RRULE", "").trim();
        List<Instant> starts = expandOccurrences(
                baseStart,
                startZone,
                rrule,
                windowStart.minus(eventDuration),
                windowEnd
        );

        List<MeetingItem> results = new ArrayList<>();
        for (Instant occurrenceStart : starts) {
            Instant occurrenceEnd = occurrenceStart.plus(eventDuration);
            if (occurrenceEnd.isBefore(windowStart) || occurrenceStart.isAfter(windowEnd)) {
                continue;
            }
            String instanceId = (uid.isEmpty() ? seriesKey : uid) + "@" + occurrenceStart;
            results.add(new MeetingItem(
                    instanceId,
                    seriesKey,
                    summary,
                    occurrenceStart,
                    occurrenceEnd,
                    joinUrl,
                    isTeams,
                    organizer
            ));
        }
        return results;
    }

    private static List<Instant> expandOccurrences(
            Instant baseStart,
            ZoneId zone,
            String rrule,
            Instant minStart,
            Instant maxStart
    ) {
        if (rrule.isEmpty()) {
            return List.of(baseStart);
        }

        Map<String, String> ruleParts = new HashMap<>();
        for (String part : rrule.split(";")) {
            int eq = part.indexOf('=');
            if (eq > 0) {
                ruleParts.put(
                        part.substring(0, eq).trim().toUpperCase(Locale.ROOT),
                        part.substring(eq + 1).trim().toUpperCase(Locale.ROOT)
                );
            }
        }

        String freq = ruleParts.getOrDefault("FREQ", "");
        if (!"DAILY".equals(freq) && !"WEEKLY".equals(freq)) {
            return List.of(baseStart);
        }

        int interval = 1;
        try {
            if (ruleParts.containsKey("INTERVAL")) {
                interval = Math.max(1, Integer.parseInt(ruleParts.get("INTERVAL")));
            }
        } catch (NumberFormatException ignored) {
            interval = 1;
        }

        int maxCount = Integer.MAX_VALUE;
        try {
            if (ruleParts.containsKey("COUNT")) {
                maxCount = Math.max(1, Integer.parseInt(ruleParts.get("COUNT")));
            }
        } catch (NumberFormatException ignored) {
            maxCount = Integer.MAX_VALUE;
        }

        Instant until = maxStart;
        if (ruleParts.containsKey("UNTIL")) {
            Instant parsedUntil = parseIcsDateTime(ruleParts.get("UNTIL"), zone);
            if (parsedUntil != null && parsedUntil.isBefore(until)) {
                until = parsedUntil;
            }
        }

        Set<DayOfWeek> byDays = parseByDay(ruleParts.getOrDefault("BYDAY", ""));
        ZonedDateTime startZdt = baseStart.atZone(zone);
        List<Instant> occurrences = new ArrayList<>();
        int generated = 0;

        if ("DAILY".equals(freq)) {
            ZonedDateTime cursor = startZdt;
            int safety = 0;
            while (!cursor.toInstant().isAfter(until)
                    && generated < maxCount
                    && safety++ < 730) {
                Instant instant = cursor.toInstant();
                if (byDays.isEmpty() || byDays.contains(cursor.getDayOfWeek())) {
                    generated++;
                    if (!instant.isBefore(minStart) && !instant.isAfter(maxStart)) {
                        occurrences.add(instant);
                    }
                }
                cursor = cursor.plusDays(interval);
            }
        } else {
            if (byDays.isEmpty()) {
                byDays = Set.of(startZdt.getDayOfWeek());
            }
            ZonedDateTime weekCursor = startZdt;
            int safety = 0;
            while (safety++ < 260 && generated < maxCount) {
                LocalDate monday = weekCursor.toLocalDate()
                        .with(DayOfWeek.MONDAY);
                boolean passedUntil = false;
                for (DayOfWeek day : DayOfWeek.values()) {
                    if (!byDays.contains(day)) {
                        continue;
                    }
                    LocalDate candidateDate = monday.with(day);
                    ZonedDateTime candidate = ZonedDateTime.of(
                            candidateDate,
                            startZdt.toLocalTime(),
                            zone
                    );
                    if (candidate.isBefore(startZdt)) {
                        continue;
                    }
                    Instant instant = candidate.toInstant();
                    if (instant.isAfter(until)) {
                        passedUntil = true;
                        break;
                    }
                    generated++;
                    if (!instant.isBefore(minStart) && !instant.isAfter(maxStart)) {
                        occurrences.add(instant);
                    }
                    if (generated >= maxCount) {
                        break;
                    }
                }
                if (passedUntil || monday.atStartOfDay(zone).toInstant().isAfter(until)) {
                    break;
                }
                weekCursor = weekCursor.plusWeeks(interval);
            }
        }

        return occurrences;
    }

    private static Set<DayOfWeek> parseByDay(String byDay) {
        if (byDay == null || byDay.isBlank()) {
            return Set.of();
        }
        Set<DayOfWeek> days = new LinkedHashSet<>();
        for (String token : byDay.split(",")) {
            String code = token.trim();
            if (code.length() >= 2) {
                code = code.substring(code.length() - 2);
            }
            switch (code) {
                case "MO" -> days.add(DayOfWeek.MONDAY);
                case "TU" -> days.add(DayOfWeek.TUESDAY);
                case "WE" -> days.add(DayOfWeek.WEDNESDAY);
                case "TH" -> days.add(DayOfWeek.THURSDAY);
                case "FR" -> days.add(DayOfWeek.FRIDAY);
                case "SA" -> days.add(DayOfWeek.SATURDAY);
                case "SU" -> days.add(DayOfWeek.SUNDAY);
                default -> {
                }
            }
        }
        return days;
    }

    static List<String> unfoldIcsLines(String text) {
        String normalized = Objects.requireNonNullElse(text, "")
                .replace("\r\n", "\n")
                .replace("\r", "\n");
        String[] rawLines = normalized.split("\n");
        List<String> unfolded = new ArrayList<>();
        for (String line : rawLines) {
            if (!line.isEmpty()
                    && (line.charAt(0) == ' ' || line.charAt(0) == '\t')
                    && !unfolded.isEmpty()) {
                int last = unfolded.size() - 1;
                unfolded.set(last, unfolded.get(last) + line.substring(1));
            } else {
                unfolded.add(line);
            }
        }
        return unfolded;
    }

    private static ZoneId resolveTimeZone(String paramPart) {
        if (paramPart == null || paramPart.isBlank()) {
            return ZoneId.systemDefault();
        }
        for (String param : paramPart.split(";")) {
            int eq = param.indexOf('=');
            if (eq > 0 && "TZID".equalsIgnoreCase(param.substring(0, eq).trim())) {
                String tzName = param.substring(eq + 1).trim().replace("\"", "");
                ZoneId mapped = mapWindowsOrIanaTimeZone(tzName);
                if (mapped != null) {
                    return mapped;
                }
            }
        }
        return ZoneId.systemDefault();
    }

    private static ZoneId mapWindowsOrIanaTimeZone(String tzName) {
        try {
            return ZoneId.of(tzName);
        } catch (Exception ignored) {
            Map<String, String> windowsMap = Map.ofEntries(
                    Map.entry("UTC", "UTC"),
                    Map.entry("W. Europe Standard Time", "Europe/Berlin"),
                    Map.entry("Central Europe Standard Time", "Europe/Budapest"),
                    Map.entry("Central European Standard Time", "Europe/Warsaw"),
                    Map.entry("Romance Standard Time", "Europe/Paris"),
                    Map.entry("GMT Standard Time", "Europe/London"),
                    Map.entry("FLE Standard Time", "Europe/Kiev"),
                    Map.entry("Eastern Standard Time", "America/New_York"),
                    Map.entry("Central Standard Time", "America/Chicago"),
                    Map.entry("Mountain Standard Time", "America/Denver"),
                    Map.entry("Pacific Standard Time", "America/Los_Angeles"),
                    Map.entry("India Standard Time", "Asia/Kolkata")
            );
            String iana = windowsMap.get(tzName);
            if (iana != null) {
                return ZoneId.of(iana);
            }
            return null;
        }
    }

    private static Instant parseIcsDateTime(String value, ZoneId fallbackZone) {
        try {
            if (value.endsWith("Z")) {
                LocalDateTime ldt = LocalDateTime.parse(value, ICS_UTC_FORMAT);
                return ldt.toInstant(ZoneOffset.UTC);
            }
            if (value.length() == 8) {
                LocalDate date = LocalDate.parse(value, ICS_DATE_FORMAT);
                return date.atStartOfDay(fallbackZone).toInstant();
            }
            if (value.length() >= 15) {
                LocalDateTime ldt = LocalDateTime.parse(
                        value.substring(0, 15),
                        ICS_LOCAL_FORMAT
                );
                return ldt.atZone(fallbackZone).toInstant();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static Instant parseGraphDateTime(JsonObject dateTimeObj) {
        if (dateTimeObj == null) {
            return null;
        }
        String raw = getString(dateTimeObj, "dateTime");
        if (raw.isEmpty()) {
            return null;
        }
        String tz = getString(dateTimeObj, "timeZone");
        try {
            if (raw.endsWith("Z") || raw.contains("+") || (raw.indexOf('-', 10) > 0)) {
                return OffsetDateTime.parse(raw).toInstant();
            }
            String trimmed = raw.length() > 19 ? raw.substring(0, 19) : raw;
            LocalDateTime ldt = LocalDateTime.parse(trimmed);
            ZoneId zone = !tz.isEmpty()
                    ? Objects.requireNonNullElse(mapWindowsOrIanaTimeZone(tz), ZoneOffset.UTC)
                    : ZoneOffset.UTC;
            return ldt.atZone(zone).toInstant();
        } catch (Exception ignored) {
            return null;
        }
    }

    static String normalizeSeriesKey(String title) {
        return Objects.requireNonNullElse(title, "")
                .trim()
                .replaceAll("\\s+", " ")
                .toLowerCase(Locale.ROOT);
    }

    static String formatDuration(int totalMinutes) {
        int hours = totalMinutes / 60;
        int minutes = totalMinutes % 60;
        if (hours > 0 && minutes > 0) {
            return hours + "h " + minutes + "m";
        }
        if (hours > 0) {
            return hours + "h";
        }
        return Math.max(1, minutes) + "m";
    }

    private static String extractTeamsLink(String text) {
        Matcher matcher = TEAMS_LINK_PATTERN.matcher(text);
        return matcher.find() ? matcher.group() : "";
    }

    private static String extractOrganizerName(String params, String value) {
        for (String part : params.split(";")) {
            int eq = part.indexOf('=');
            if (eq > 0 && "CN".equalsIgnoreCase(part.substring(0, eq).trim())) {
                return part.substring(eq + 1).trim().replace("\"", "");
            }
        }
        if (value.regionMatches(true, 0, "mailto:", 0, 7)) {
            return value.substring(7).trim();
        }
        return "";
    }

    private static String unescapeIcsText(String value) {
        return Objects.requireNonNullElse(value, "")
                .replace("\\n", "\n")
                .replace("\\N", "\n")
                .replace("\\,", ",")
                .replace("\\;", ";")
                .replace("\\\\", "\\");
    }

    private static String getString(JsonObject obj, String key) {
        if (obj == null || !obj.has(key) || obj.get(key).isJsonNull()) {
            return "";
        }
        return obj.get(key).getAsString().trim();
    }

    private static Transport defaultTransport(HttpClient client) {
        return (url, headers) -> {
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(20))
                    .GET();
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                builder.header(entry.getKey(), entry.getValue());
            }
            HttpResponse<String> response = client.send(
                    builder.build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalArgumentException(
                        MESSAGES.getString("meetings.sync.failed")
                );
            }
            return response.body();
        };
    }
}
