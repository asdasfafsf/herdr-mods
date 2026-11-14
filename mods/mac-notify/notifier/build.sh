#!/bin/sh
# HerdrNotify.app 을 빌드해 ~/Applications 에 설치한다 (mac-notify mod 가 배너를 띄울 때 쓰는 앱).
# 아이콘은 설치된 Herdr.app 의 것을 그대로 쓴다. 고친 뒤 다시 실행하면 덮어쓴다.
#
# 필요한 것: swiftc (Xcode Command Line Tools). 서명은 이 Mac 에서만 쓰는 ad-hoc 서명이다.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
bundle_id="local.herdr-mods.notify"
dest="${HERDR_NOTIFY_DIR:-$HOME/Applications}/HerdrNotify.app"

# 같은 자리에 다른 앱이 있으면 지우지 않는다.
if [ -e "$dest" ]; then
  existing="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$dest/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$existing" != "$bundle_id" ]; then
    echo "skip: $dest 에 다른 앱($existing)이 있어요. 직접 정리하세요" >&2
    exit 1
  fi
fi

herdr="$(mdfind "kMDItemCFBundleIdentifier == 'dev.herdr.app'" 2>/dev/null | head -1)"
if [ -z "$herdr" ]; then
  for d in "$HOME/Applications/Herdr.app" "/Applications/Herdr.app"; do
    [ -d "$d" ] && herdr="$d" && break
  done
fi

build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
app="$build/HerdrNotify.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

swiftc -O -o "$app/Contents/MacOS/HerdrNotify" "$here/main.swift"
cp "$here/Info.plist" "$app/Contents/Info.plist"

icon=""
if [ -n "$herdr" ]; then
  name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$herdr/Contents/Info.plist" 2>/dev/null || echo Herdr)"
  icon="$herdr/Contents/Resources/${name%.icns}.icns"
fi
if [ -n "$icon" ] && [ -f "$icon" ]; then
  cp "$icon" "$app/Contents/Resources/AppIcon.icns"
else
  echo "Herdr.app 아이콘을 못 찾아 기본 아이콘으로 빌드해요" >&2
fi

codesign --force --sign - "$app"

mkdir -p "$(dirname "$dest")"
rm -rf "$dest"
ditto "$app" "$dest"
# 배너를 눌렀을 때 macOS 가 이 앱을 찾아 실행할 수 있게 등록한다.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$dest"
echo "installed $dest"
