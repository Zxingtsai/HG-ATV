"""Package the parallel-install account preview and an allowlisted server overlay."""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'dist/account-client-preview'
VERSION = '0.1.2-preview'
GUIDE = '''# 红果 TV 账号预览 0.1.2

1. 在原服务端目录运行 windows/stop.cmd，将服务端更新 ZIP 解压到原目录、合并并覆盖源码，再运行 windows/start.cmd。不需要删除 data、runtime 或 windows/local.settings.json。
2. 在电视安装 hongguo-tv-account-preview-0.1.2.apk。应用名为“红果 TV 账号预览”，包名 cn.hongguotv.preview，与旧客户端并存。此 APK 的签名与仓库 0.1.0 不同，不能直接覆盖旧版；无需卸载旧版，旧版本机数据保留。
3. 预览版首次启动需要重新配对服务器。打开“账号”，用支持“扫一扫”的红果 App 扫码并在手机确认；服务端验证成功后，首页显示最近观看，云历史/云收藏菜单可刷新。
4. 云收藏目前只读，请在手机修改。添加收藏的受控测试被官网返回 101144 拒绝，未启用生产写入。
5. 切换家人账号：在预览版“账号”中退出，再用家人的红果 App 扫码。一个服务端共享一个账号。退出不清除本机历史/收藏；预览版与旧 APK 的本机数据互相独立。

需要原服务端的 Node 24+ 环境及 Edge/Chrome。包内不含账号、Cookie、二维码、手机原包、运行时或私人配置。
源码编译、服务端自动测试与真实账号读取已验证；目标电视和 Windows 实机仍待验收。详见 docs/ACCOUNT.zh-CN.md。
'''

def build():
    metadata_path = ROOT / 'client/app/build/outputs/apk/accountPreview/output-metadata.json'
    metadata = json.loads(metadata_path.read_text())
    assert metadata['applicationId'] == 'cn.hongguotv.preview'
    entry = metadata['elements'][0]
    assert entry['versionCode'] == 2 and entry['versionName'] == VERSION
    apk = metadata_path.parent / entry['outputFile']
    assert apk.is_file() and apk.parent == metadata_path.parent
    with ZipFile(apk) as package:
        assert package.testzip() is None and 'AndroidManifest.xml' in package.namelist()
    names = ['server/package.json', 'docs/ACCOUNT.zh-CN.md', 'docs/API.md', 'LICENSE',
             'research/account-client/README.zh-CN.md', 'docs/verification/account-client-live.json']
    for folder in ['server/src', 'server/scripts']:
        names += [p.relative_to(ROOT).as_posix() for p in (ROOT / folder).rglob('*') if p.is_file()]
    names += [p.relative_to(ROOT).as_posix() for p in (ROOT / 'windows').iterdir() if p.suffix in {'.ps1', '.cmd'}]
    names += [p.relative_to(ROOT).as_posix() for p in (ROOT / 'docs/verification').glob('account-anonymous-*.json')]
    files = {name: (ROOT / name).read_bytes() for name in sorted(set(names))}
    files['ACCOUNT-UPDATE.zh-CN.md'] = GUIDE.encode('utf-8')
    for name in files:
        assert not any(part in {'data', 'runtime', 'node_modules', '..'} for part in Path(name).parts)
        assert not name.endswith(('.key', '.enc', '.apk', '.jks', '.keystore'))
        assert Path(name).name not in {'local.settings.json', 'local.properties', 'paired-clients.json'}
    manifest = {name: sha256(data).hexdigest() for name, data in files.items()}
    files['ACCOUNT-UPDATE-SHA256.json'] = (json.dumps({'version': VERSION, 'files': manifest}, ensure_ascii=False, indent=2) + '\n').encode()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = OUTPUT / 'hongguo-tv-server-account-preview-0.1.2.zip'
    with ZipFile(server, 'w', ZIP_DEFLATED) as bundle:
        for name, data in sorted(files.items()):
            info = ZipInfo(name, (2026, 10, 26, 0, 0, 0)); info.compress_type = ZIP_DEFLATED; info.external_attr = 0o100644 << 16
            bundle.writestr(info, data)
    with ZipFile(server) as bundle:
        assert bundle.testzip() is None
        assert set(bundle.namelist()) == set(files)
        for name, digest in manifest.items(): assert sha256(bundle.read(name)).hexdigest() == digest
    output_apk = OUTPUT / 'hongguo-tv-account-preview-0.1.2.apk'
    shutil.copyfile(apk, output_apk)
    guide = OUTPUT / 'INSTALL.zh-CN.md'; guide.write_text(GUIDE)
    artifacts = [output_apk, server, guide]
    (OUTPUT / 'SHA256SUMS.txt').write_text(''.join(f'{sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in artifacts))
    print(json.dumps([{'path': str(p), 'bytes': p.stat().st_size, 'sha256': sha256(p.read_bytes()).hexdigest()} for p in artifacts], indent=2))

if __name__ == '__main__':
    build()
