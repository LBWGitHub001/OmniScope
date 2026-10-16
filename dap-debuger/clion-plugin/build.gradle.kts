plugins {
    id("org.jetbrains.kotlin.jvm") version "2.4.0"
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.0"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "com.rm2027"
version = "0.1.0"

kotlin {
    jvmToolchain(25)
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        clion("2026.2.3")
        bundledPlugin("com.intellij.clion")
        composeUI()
    }
    implementation("com.fazecast:jSerialComm:2.11.2")
}

intellijPlatform {
    pluginConfiguration {
        id = "com.rm2027.swd-watch"
        name = "SWD Watch"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "262"
        }
    }
}

tasks {
    wrapper {
        gradleVersion = "9.1.0"
    }
}
