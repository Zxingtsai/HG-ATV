"""Build reviewable source and Windows bundles from explicit project allowlists."""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json, shutil
ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
VERSION = '0.1.0'

def add_tree(files, folder):
    for path in (ROOT / folder).rglob('*'):
        if path.is_file() and not any(part in {'.tools', '.gradle', 'build', '__pycache__', 'node_modules'} for part in path.parts):
            files[path.relative_to(ROOT).as_posix()] = path.read_bytes()

def build(apk):
    DIST.mkdir(exist_ok=True)
    common = {}
    for name in ['README.zh-CN.md', 'LICENSE']:
        common[name] = (ROOT / name).read_bytes()
    for folder in ['server/src', 'server/scripts', 'server/tests', 'windows', 'docs']:
        add_tree(common, folder)
    common['server/package.json'] = (ROOT/'server/package.json').read_bytes()
    fixtures = ['category_real-drama.html','detail-merged.json','detail.html','home.html','page-bb05dc60819a.json','rank_hot-drama.html','search_%E5%86%9B%E9%9C%80%E5%A4%84%E9%95%BF.html']
    for name in fixtures:
        common['research/web/' + name] = (ROOT/'research/web'/name).read_bytes()
    with ZipFile(DIST/'hongguo-analysis.zip') as analysis:
        for name in analysis.namelist():
            if not name.endswith('/') and name not in common:
                common[name] = analysis.read(name)
    common['client/README.md'] = (ROOT/'client/README.md').read_bytes()
    source = dict(common)
    source['.gitignore'] = (ROOT/'.gitignore').read_bytes()
    add_tree(source, 'client/app/src')
    add_tree(source, 'client/gradle')
    for name in ['client/settings.gradle.kts','client/build.gradle.kts','client/gradle.properties','client/gradlew','client/gradlew.bat','client/build-local.sh','client/app/build.gradle.kts','client/app/proguard-rules.pro','tools/verify-lan.mjs','tools/package.py']:
        path=ROOT/name
        if path.exists():source[name]=path.read_bytes()
    windows = dict(common)
    windows['client/dist/hongguo-tv.apk'] = apk.read_bytes()
    # Credentials, local settings, original binaries and downloaded SDK/runtime are never allowed.
    for kind, files in [('windows',windows), ('source',source)]:
        for name in files:
            assert '.private.' not in name and '..' not in Path(name).parts
            assert not name.startswith(('data/','runtime/','client/.tools/','client/.gradle/'))
            assert not name.endswith(('.dex','.xz','.mp4','.jks'))
            assert not name.endswith('.apk') or name == 'client/dist/hongguo-tv.apk'
            assert Path(name).name not in {'local.settings.json','local.properties','paired-clients.json'}
        manifest={'version':VERSION,'kind':kind,'files':[{'path':name,'sha256':sha256(data).hexdigest()} for name,data in sorted(files.items())]}
        files['SHA256.json']=json.dumps(manifest,ensure_ascii=False,indent=2).encode()
        target=DIST/f'hongguo-tv-{kind}-{VERSION}.zip'
        with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as bundle:
            for name,data in sorted(files.items()):
                entry=ZipInfo(f'hongguo-tv-{VERSION}/{name}')
                entry.compress_type=ZIP_DEFLATED
                executable=name.endswith('.sh') or name=='client/gradlew'
                entry.external_attr=((0o100755 if executable else 0o100644) << 16)
                bundle.writestr(entry,data,compresslevel=9)
        with ZipFile(target) as bundle:
            assert bundle.testzip() is None
            for row in manifest['files']:
                assert sha256(bundle.read(f'hongguo-tv-{VERSION}/'+row['path'])).hexdigest()==row['sha256']
        print(target.name,target.stat().st_size,'bytes',len(files),'files')
    standalone=DIST/f'hongguo-tv-{VERSION}.apk'
    shutil.copyfile(apk,standalone)
    artifacts=[standalone,DIST/f'hongguo-tv-windows-{VERSION}.zip',DIST/f'hongguo-tv-source-{VERSION}.zip',DIST/'hongguo-analysis.zip']
    (DIST/'SHA256SUMS.txt').write_text(''.join(f'{sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in artifacts))

if __name__=='__main__':
    build(ROOT/'client/app/build/outputs/apk/debug/app-debug.apk')
