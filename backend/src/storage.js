const path = require('path');

// Single source of truth for where files live on disk. Shared by the
// authenticated file routes and the public share routes so both sandbox
// paths in exactly the same way.
const STORAGE_ROOT = process.env.STORAGE_ROOT
    ? path.resolve(process.env.STORAGE_ROOT)
    : path.resolve(__dirname, '../storage');

const ROOT_WITH_SEP = STORAGE_ROOT.endsWith(path.sep) ? STORAGE_ROOT : STORAGE_ROOT + path.sep;

// Resolves a user-supplied relative path to an absolute one, throwing if it
// would escape STORAGE_ROOT. (The separator check also rejects siblings such
// as "<root>-backup", which a bare startsWith(STORAGE_ROOT) would let through.)
const getSafePath = (userPath) => {
    const targetPath = path.resolve(STORAGE_ROOT, userPath || '');
    if (targetPath !== STORAGE_ROOT && !targetPath.startsWith(ROOT_WITH_SEP)) {
        throw new Error('Access denied: Path out of bounds');
    }
    return targetPath;
};

// Absolute path -> canonical relative path ("folder/file.txt", forward
// slashes, no leading slash). Same format the frontend uses everywhere.
const toRelative = (absPath) => path.relative(STORAGE_ROOT, absPath).split(path.sep).join('/');

module.exports = { STORAGE_ROOT, getSafePath, toRelative };
