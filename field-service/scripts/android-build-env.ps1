# Dot-source this script to set only the current terminal environment.
param(
  [Parameter(Mandatory=$true)][string]$JavaPath,
  [Parameter(Mandatory=$true)][string]$SdkPath,
  [string]$GradleCachePath = 'D:\Android\gradle-cache'
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath (Join-Path $JavaPath 'bin/javac.exe'))) { throw 'JavaPath must point to an installed JDK.' }
if (!(Test-Path -LiteralPath $SdkPath)) { throw 'SdkPath does not exist.' }
$env:JAVA_HOME = (Resolve-Path -LiteralPath $JavaPath).Path
$env:ANDROID_HOME = (Resolve-Path -LiteralPath $SdkPath).Path
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = $GradleCachePath
$env:EXPO_PUBLIC_API_URL = 'https://api-staging.koochang.com'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"
Write-Output 'Android build environment configured for this terminal only (staging API).'
