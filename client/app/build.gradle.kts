plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "cn.hongguotv"
    compileSdk = 35
    defaultConfig { applicationId = "cn.hongguotv"; minSdk = 26; targetSdk = 35; versionCode = 2; versionName = "0.1.2"; manifestPlaceholders["appLabel"] = "红果 TV" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") }
        create("accountPreview") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".preview"
            versionNameSuffix = "-preview"
            manifestPlaceholders["appLabel"] = "红果 TV 账号预览"
            matchingFallbacks += listOf("debug")
        }
    }
}
dependencies {
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
}
