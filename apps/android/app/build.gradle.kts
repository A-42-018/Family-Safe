import com.android.build.api.artifact.SingleArtifact
import org.gradle.api.DefaultTask
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
}

val appId = "app.familysafe.child"
val localApiBaseUrl = "http://10.0.2.2:54321/functions/v1"
val apiBaseUrlProperty: Provider<String> = providers.gradleProperty("familysafe.apiBaseUrl")

android {
    namespace = appId
    compileSdk = 36

    defaultConfig {
        applicationId = appId
        minSdk = 31 // Android 12 (prompt §50 tests Android 12-16)
        targetSdk = 36
        versionCode = 1
        versionName = "0.18.0"
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrlProperty.getOrElse(localApiBaseUrl)}\"")
        }
        release {
            // Empty when unset; `verifyReleaseApiBaseUrl` (below) fails the build before it can be used.
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrlProperty.getOrElse("")}\"")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // "newer version available" nags are handled by deliberate bumps, not by failing the build.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable")
    }

    testOptions {
        unitTests.all { it.useJUnitPlatform() }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

ktlint {
    android.set(true)
    ignoreFailures.set(false)
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.work.runtime) // Phase 12: HeartbeatWorker
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.kotlinx.serialization.json)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.ktor.client.mock)
    testRuntimeOnly(libs.junit.platform.launcher)
}

// ---------------------------------------------------------------------------------------------------------------
// Guard 1: a release build must never silently point at the local emulator address or at cleartext HTTP.
// ---------------------------------------------------------------------------------------------------------------
val verifyReleaseApiBaseUrl by tasks.registering {
    group = "verification"
    description = "Fails if -Pfamilysafe.apiBaseUrl is missing or not https for a release build."
    val value = apiBaseUrlProperty
    doLast {
        val url = value.orNull
        require(!url.isNullOrBlank() && url.startsWith("https://")) {
            "Release builds require -Pfamilysafe.apiBaseUrl=https://<project-ref>.supabase.co/functions/v1"
        }
    }
}
tasks.configureEach {
    if (name == "preReleaseBuild") dependsOn(verifyReleaseApiBaseUrl)
}

// ---------------------------------------------------------------------------------------------------------------
// Guard 2: the MERGED manifest (app + every library) may only request the permissions listed here.
// A dependency can add permissions silently through manifest merging; this makes that a build failure.
// Adding a permission in a later phase = add it to the app manifest AND to this list, with a justification
// in docs/ANDROID_PERMISSIONS.md.
// ---------------------------------------------------------------------------------------------------------------
abstract class VerifyManifestPermissionsTask : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val mergedManifest: RegularFileProperty

    @get:Input
    abstract val allowedPermissions: ListProperty<String>

    /** androidx.core adds an app-private, signature-level permission of the form `<applicationId>.<suffix>`. */
    @get:Input
    abstract val ownPackage: Property<String>

    @get:Input
    abstract val allowedOwnSuffixes: ListProperty<String>

    @TaskAction
    fun verify() {
        val text = mergedManifest.get().asFile.readText()
        val requested = Regex("""<uses-permission(?:-sdk-23)?\b[^>]*?android:name="([^"]+)"""")
            .findAll(text)
            .map { it.groupValues[1] }
            .toSortedSet()
        val own = ownPackage.get()
        val unexpected = requested.filterNot { name ->
            name in allowedPermissions.get() ||
                allowedOwnSuffixes.get().any { suffix -> name == "$own.$suffix" }
        }
        if (unexpected.isNotEmpty()) {
            throw GradleException(
                "Merged manifest requests unexpected permissions: $unexpected. " +
                    "Remove them (tools:node=\"remove\") or allow them deliberately in app/build.gradle.kts.",
            )
        }
    }
}

androidComponents {
    onVariants { variant ->
        val capitalized = variant.name.replaceFirstChar { it.uppercase() }
        val task = tasks.register<VerifyManifestPermissionsTask>("verify${capitalized}ManifestPermissions") {
            group = "verification"
            description = "Checks the merged ${variant.name} manifest against the permission allow-list."
            mergedManifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
            allowedPermissions.set(
                listOf(
                    "android.permission.INTERNET",
                    "android.permission.ACCESS_NETWORK_STATE",
                    // Phase 12: WorkManager reboot reschedule
                    "android.permission.RECEIVE_BOOT_COMPLETED",
                    // Phase 16b: Usage Access, switched on by the child
                    "android.permission.PACKAGE_USAGE_STATS",
                ),
            )
            ownPackage.set(appId)
            allowedOwnSuffixes.set(listOf("DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"))
        }
        tasks.named("check").configure { dependsOn(task) }
    }
}
