package dev.jiraissuetracker.intellij;

import org.junit.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.Assert.*;

public class TeamsMeetingsClientTest {

    @Test
    public void when_icsContainsSingleRecurringAndCancelledEvents_then_fetchFromIcs_should_ReturnExpandedUpcomingTeamsMeetings() throws Exception {
        String ics = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                UID:standup-uid
                SUMMARY:Daily Standup
                DTSTART:20261116T090000Z
                DTEND:20261116T091500Z
                RRULE:FREQ=DAILY;COUNT=3
                DESCRIPTION:Join Microsoft Teams Meeting \\nhttps://teams.microsoft.com/l/meetup-join/19%3ameeting_abc
                END:VEVENT
                BEGIN:VEVENT
                UID:cancelled-uid
                SUMMARY:Cancelled Sync
                STATUS:CANCELLED
                DTSTART:20261116T110000Z
                DTEND:20261116T113000Z
                END:VEVENT
                BEGIN:VEVENT
                UID:planning-uid
                SUMMARY:[PROJ-42] Sprint
                  Planning
                DTSTART:20261117T140000Z
                DTEND:20261117T153000Z
                LOCATION:Microsoft Teams Meeting
                END:VEVENT
                END:VCALENDAR
                """;

        Instant windowStart = Instant.parse("2026-11-16T00:00:00Z");
        Instant windowEnd = Instant.parse("2026-11-20T00:00:00Z");

        TeamsMeetingsClient client = new TeamsMeetingsClient(
                (url, headers) -> {
                    assertEquals("https://outlook.office365.com/calendar.ics", url);
                    return ics;
                },
                windowStart,
                windowEnd
        );

        List<TeamsMeetingsClient.MeetingItem> meetings =
                client.fetchFromIcs("webcal://outlook.office365.com/calendar.ics");

        assertEquals(4, meetings.size());
        assertEquals("Daily Standup", meetings.get(0).title);
        assertEquals(15, meetings.get(0).durationMinutes);
        assertEquals("15m", meetings.get(0).durationFormatted);
        assertTrue(meetings.get(0).isTeamsMeeting);
        assertEquals(
                "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc",
                meetings.get(0).joinUrl
        );

        TeamsMeetingsClient.MeetingItem planning = meetings.get(2);
        assertEquals("[PROJ-42] Sprint Planning", planning.title);
        assertEquals(90, planning.durationMinutes);
        assertEquals("1h 30m", planning.durationFormatted);
        assertTrue(planning.isTeamsMeeting);
    }

    @Test
    public void when_graphCalendarViewIsReturned_then_fetchFromGraph_should_ParseOnlineMeetingsAndSeriesKey() throws Exception {
        String graphJson = """
                {
                  "value": [
                    {
                      "id": "evt-1",
                      "seriesMasterId": "series-99",
                      "subject": "Architecture Review",
                      "isCancelled": false,
                      "isOnlineMeeting": true,
                      "onlineMeeting": {
                        "joinUrl": "https://teams.microsoft.com/l/meetup-join/arch"
                      },
                      "start": { "dateTime": "2026-11-16T10:00:00.0000000", "timeZone": "UTC" },
                      "end": { "dateTime": "2026-11-16T11:00:00.0000000", "timeZone": "UTC" },
                      "organizer": { "emailAddress": { "name": "Alice" } }
                    },
                    {
                      "id": "evt-cancelled",
                      "subject": "Skipped Meeting",
                      "isCancelled": true,
                      "start": { "dateTime": "2026-11-16T12:00:00.0000000", "timeZone": "UTC" },
                      "end": { "dateTime": "2026-11-16T12:30:00.0000000", "timeZone": "UTC" }
                    }
                  ]
                }
                """;

        Instant windowStart = Instant.parse("2026-11-16T00:00:00Z");
        Instant windowEnd = Instant.parse("2026-11-17T00:00:00Z");

        TeamsMeetingsClient client = new TeamsMeetingsClient(
                (url, headers) -> {
                    assertEquals("Bearer test-graph-token", headers.get("Authorization"));
                    return graphJson;
                },
                windowStart,
                windowEnd
        );

        List<TeamsMeetingsClient.MeetingItem> meetings =
                client.fetchFromGraph("test-graph-token");

        assertEquals(1, meetings.size());
        TeamsMeetingsClient.MeetingItem item = meetings.get(0);
        assertEquals("evt-1", item.id);
        assertEquals("series-99", item.seriesKey);
        assertEquals("Architecture Review", item.title);
        assertEquals(60, item.durationMinutes);
        assertEquals("1h", item.durationFormatted);
        assertEquals("https://teams.microsoft.com/l/meetup-join/arch", item.joinUrl);
        assertTrue(item.isTeamsMeeting);
        assertEquals("Alice", item.organizer);
    }
}
