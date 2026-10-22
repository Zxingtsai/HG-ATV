"""Build a small source-only server overlay; never package user data or APKs."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'releases/account-preview/hongguo-tv-account-preview-0.1.1.zip'

def build():
    paths = [ROOT / name for name in ['server/package.json', 'windows/account-login.cmd',
        'windows/account-login.ps1', 'docs/ACCOUNT.zh-CN.md', 'docs/API.md',
        'docs/verification/account-anonymous-api.json', 'docs/verification/account-anonymous-ui.json']]
    for directory in ['server/src', 'server/scripts']:
        paths.extend(path for path in (ROOT / directory).rglob('*') if path.is_file())
    files = {str(path.relative_to(ROOT)).replace('\\', '/'): path.read_bytes() for path in paths}
    files['ACCOUNT-UPDATE.zh-CN.md'] = (
        '# 红果 TV 服务端账号预览更新 0.1.1\n\n'
        '先运行原目录 windows/stop.cmd，再将本 ZIP 的内容解压到原安装目录，合并文件夹并覆盖同名源码。\n'
        '保留原 data、runtime 与 windows/local.settings.json，不需要重新 setup 或更换电视 APK。\n'
        '启动 windows/start.cmd，再运行 windows/account-login.cmd，用手机红果 App 扫码并确认。\n\n'
        '需要服务器已安装 Edge 或 Chrome。详情及真实账号/Windows 尚待验证的范围见 docs/ACCOUNT.zh-CN.md。\n'
        '这是官网会话登录预览，不包含 App 原生接口或云收藏同步。\n'
    ).encode('utf-8')
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}
    files['ACCOUNT-UPDATE-SHA256.json'] = (json.dumps({'version': '0.1.1-account-preview', 'files': manifest}, ensure_ascii=False, indent=2) + '\n').encode()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(2026, 10, 22, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, data)
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    OUTPUT.with_suffix('.zip.sha256').write_text(f'{digest}  {OUTPUT.name}\n')
    with zipfile.ZipFile(OUTPUT) as archive:
        assert archive.testzip() is None
        actual = {name for name in archive.namelist() if name != 'ACCOUNT-UPDATE-SHA256.json'}
        assert actual == set(manifest)
        for name, expected in manifest.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == expected
            assert not any(part in {'data', 'runtime', 'node_modules'} for part in Path(name).parts)
        assert archive.read('windows/account-login.ps1').startswith(b'\xef\xbb\xbf')
    print(json.dumps({'file': str(OUTPUT), 'bytes': OUTPUT.stat().st_size, 'sha256': digest, 'members': len(files)}, indent=2))

if __name__ == '__main__':
    build()
