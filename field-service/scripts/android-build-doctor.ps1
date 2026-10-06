param(
  [string]$SdkPath = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }),
  [string]$JavaPath = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$versionFile = Join-Path $workspacePath 'apps/mobile/node_modules/react-native/gradle/libs.versions.toml'
if (!(Test-Path -LiteralPath $versionFile)) { throw 'Install workspace dependencies first: pnpm install --frozen-lockfile' }
$versionsText = Get-Content -LiteralPath $versionFile -Raw
function Read-Version([string]$name) {
  $found = [regex]::Match($versionsText, '(?m)^' + [regex]::Escape($name) + '\s*=\s*"([^"]+)"')
  if (!$found.Success) { throw "Cannot determine $name from installed React Native" }
  return $found.Groups[1].Value
}
$compileSdk = Read-Version 'compileSdk'
$buildTools = Read-Version 'buildTools'
$ndk = Read-Version 'ndkVersion'
$javaCommand = Get-Command java -ErrorAction SilentlyContinue
$javacCommand = Get-Command javac -ErrorAction SilentlyContinue
$javaExe = if ($JavaPath) { Join-Path $JavaPath 'bin/java.exe' } elseif ($javaCommand) { $javaCommand.Source } else { '' }
$javacExe = if ($JavaPath) { Join-Path $JavaPath 'bin/javac.exe' } elseif ($javacCommand) { $javacCommand.Source } else { '' }
$checks = @(
  [pscustomobject]@{ Item='Java runtime'; Ready=([bool]$javaExe -and (Test-Path -LiteralPath $javaExe)); Required='JDK 17 or compatible JDK'; Path=$javaExe },
  [pscustomobject]@{ Item='Java compiler'; Ready=([bool]$javacExe -and (Test-Path -LiteralPath $javacExe)); Required='Full JDK, not JRE'; Path=$javacExe },
  [pscustomobject]@{ Item='Android platform'; Ready=(Test-Path -LiteralPath (Join-Path $SdkPath "platforms/android-$compileSdk/android.jar")); Required="platforms;android-$compileSdk"; Path=$SdkPath },
  [pscustomobject]@{ Item='Build tools'; Ready=(Test-Path -LiteralPath (Join-Path $SdkPath "build-tools/$buildTools/apksigner.bat")); Required="build-tools;$buildTools"; Path=$SdkPath },
  [pscustomobject]@{ Item='NDK'; Ready=(Test-Path -LiteralPath (Join-Path $SdkPath "ndk/$ndk/source.properties")); Required="ndk;$ndk"; Path=$SdkPath },
  [pscustomobject]@{ Item='SDK Manager'; Ready=(Test-Path -LiteralPath (Join-Path $SdkPath 'cmdline-tools/latest/bin/sdkmanager.bat')); Required='cmdline-tools;latest'; Path=$SdkPath },
  [pscustomobject]@{ Item='ADB'; Ready=(Test-Path -LiteralPath (Join-Path $SdkPath 'platform-tools/adb.exe')); Required='platform-tools'; Path=$SdkPath }
)
$checks | Format-Table Item,Ready,Required -AutoSize
if ($checks | Where-Object { !$_.Ready }) { Write-Output 'NOT READY: install/configure missing tools. Signing credentials are also required for an upgrade APK.'; exit 1 }
& $javaExe -version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $javacExe -version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'Core tools found. Gradle downloads, SDK licenses, CMake and original signing credentials still need verification during the first native build.'
