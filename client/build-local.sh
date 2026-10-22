#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Keep the inherited environment proxy and the JVM's configured CA trust.
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/workspace/tools/android}"
if [[ -x "$PWD/.tools/jdk/bin/javac" ]]; then export JAVA_HOME="$PWD/.tools/jdk"; fi
exec python3 - "$@" <<'PY'
import os,sys,urllib.parse
proxy=urllib.parse.urlparse(os.environ.get('HTTPS_PROXY',''))
args=['/workspace/tools/gradle-8.11.1/bin/gradle','--no-daemon']
if proxy.hostname:
    for scheme in ['http','https']:
        args += ['-D%s.proxyHost=%s'%(scheme,proxy.hostname),'-D%s.proxyPort=%s'%(scheme,proxy.port or 8080)]
args += sys.argv[1:] or [':app:assembleDebug',':app:lintDebug']
os.execv(args[0],args)
PY
