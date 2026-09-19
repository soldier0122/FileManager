// Shared by the dashboard, the share modal and the public share page.

export const getFileInfo = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return { type: 'image', icon: '🖼️' };
  if (['mp4', 'webm', 'mkv', 'avi'].includes(ext)) return { type: 'video', icon: '🎬' };
  if (['mp3', 'wav', 'ogg'].includes(ext)) return { type: 'audio', icon: '🎵' };
  if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) return { type: 'archive', icon: '📦' };
  if (['pdf'].includes(ext)) return { type: 'pdf', icon: '📕' };
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'lua'].includes(ext)) return { type: 'code', icon: '📝' };
  return { type: 'text', icon: '📄' };
};

export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};
