import { mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

if (process.platform === 'win32') {
  console.error('Run these commands inside a WSL Ubuntu terminal on Windows. Docker is not required.');
  process.exit(1);
}
const folder = resolve('.venv');
const python = join(folder, 'bin', 'python');
const run = (cmd, args, quiet = false) => {
  const result = spawnSync(cmd, args, { stdio: quiet ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')}: ${result.error?.message || `exit ${result.status}`}`);
  }
  return result.stdout?.trim();
};
try {
  if (!existsSync(python)) run(process.env.PYTHON || 'python3', ['-m', 'venv', folder]);
  const systemFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  const packages = ['yt-dlp[default]'];
  if (!systemFfmpeg && !process.env.FFMPEG_BIN) packages.push('imageio-ffmpeg');
  if (!process.argv.includes('--no-whisper')) packages.push('faster-whisper>=1.2,<2');
  run(python, ['-m', 'pip', 'install', '--upgrade', ...packages]);
  if (packages.includes('imageio-ffmpeg')) {
    const path = run(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], true);
    mkdirSync(join(folder, 'bin'), { recursive: true });
    if (!existsSync(join(folder, 'bin', 'ffmpeg'))) symlinkSync(path, join(folder, 'bin', 'ffmpeg'));
  }
  if (!process.argv.includes('--no-whisper') && process.argv.includes('--download-model')) {
    run(python, ['-c', 'import os; from faster_whisper import WhisperModel; WhisperModel(os.getenv("WHISPER_MODEL", "base"), device="cpu", compute_type="int8")']);
  }
  console.log('\nMedia tools installed. Start Clipforge with npm run dev.');
  if (!process.argv.includes('--no-whisper') && !process.argv.includes('--download-model')) {
    console.log('Whisper weights download on first use. Run npm run setup -- --download-model to fetch them now.');
  }
} catch (error) {
  console.error(`\nSetup failed. Install Python 3.10+ (including python3-venv on Debian/Ubuntu) and optionally system FFmpeg.\n${error.message}`);
  process.exit(1);
}
