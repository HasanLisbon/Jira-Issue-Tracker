import org.gradle.api.tasks.Sync
import org.gradle.api.tasks.compile.JavaCompile

plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "dev.jiraissuetracker"
version = "0.1.2"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    intellijPlatform {
        val localPlatformPath = providers.gradleProperty("platformPath")
        if (localPlatformPath.isPresent) {
            local(localPlatformPath.get())
        } else {
            intellijIdea(providers.gradleProperty("platformVersion"))
        }
        val platformVer = providers.gradleProperty("platformVersion").orNull ?: ""
        val isLegacyMonolithPlatform = platformVer.startsWith("2022") ||
            platformVer.startsWith("2023") ||
            platformVer.startsWith("2024") ||
            platformVer.startsWith("22") ||
            platformVer.startsWith("23") ||
            platformVer.startsWith("24")
        if (!isLegacyMonolithPlatform) {
            bundledPlugin("com.intellij.modules.jcef")
            bundledModule("intellij.platform.vcs.dvcs")
            bundledModule("intellij.platform.vcs.dvcs.impl")
        }
        bundledPlugin("Git4Idea")
    }
    testImplementation("junit:junit:4.13.2")
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
}

tasks.test {
    useJUnit()
}

val buildFrontend by tasks.registering(Exec::class) {
    val npmCommand = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "npm.cmd" else "npm"
    commandLine(npmCommand, "run", "build")
    inputs.files(
        fileTree("src") {
            include("**/*.tsx", "**/*.ts", "**/*.css")
        },
        file("index.html"),
        file("package.json"),
        file("src/main/resources/src.properties"),
        file("vite.config.ts"),
    )
    outputs.dir(layout.projectDirectory.dir("dist"))
}

val bundleFrontend by tasks.registering(Sync::class) {
    dependsOn(buildFrontend)
    from(layout.projectDirectory.dir("dist"))
    into(layout.buildDirectory.dir("generated-resources/web"))
}

val testFrontend by tasks.registering(Exec::class) {
    dependsOn(buildFrontend)
    val nodeCommand = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "node.exe" else "node"
    commandLine(nodeCommand, "--test", "src/jira.test.mjs", "src/branches.browser.test.mjs")
    inputs.files(fileTree("src") { include("**/*.ts", "**/*.tsx", "**/*.test.mjs") })
}

tasks.check {
    dependsOn(testFrontend)
}

sourceSets.main {
    resources.srcDir(layout.buildDirectory.dir("generated-resources"))
}

tasks.processResources {
    dependsOn(bundleFrontend)
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null }
        }
    }
}
