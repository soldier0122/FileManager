const { ZipArchive } = require('archiver');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

const STORAGE_ROOT = process.env.STORAGE_ROOT 
    ? path.resolve(process.env.STORAGE_ROOT) 
    : path.resolve(__dirname, '../../storage');

const getSafePath = (userPath) => {
    const targetPath = path.resolve(STORAGE_ROOT, userPath || '');
    if (!targetPath.startsWith(STORAGE_ROOT)) {
        throw new Error('Access denied: Path out of bounds');
    }
    return targetPath;
};

// GET /api/files?path=...
router.get('/', authenticateToken, async (req, res) => {
    try {
        await fs.mkdir(STORAGE_ROOT, { recursive: true });
        
        const relativePath = req.query.path || '';
        const targetPath = getSafePath(relativePath);

        const items = await fs.readdir(targetPath, { withFileTypes: true });
        
        const fileList = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            path: path.join(relativePath, item.name).replace(/\\/g, '/')
        }));

        fileList.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
            return a.isDirectory ? -1 : 1;
        });

        res.json({ currentPath: relativePath, files: fileList });
    } catch (error) {
        console.error('Read error:', error);
        res.status(error.message.includes('Access denied') ? 403 : 500).json({ error: 'Failed to read directory' });
    }
});

// POST /api/files/folder
router.post('/folder', authenticateToken, async (req, res) => {
    try {
        const { currentPath, folderName } = req.body;
        if (!folderName) return res.status(400).json({ error: 'Folder name required' });

        const newFolderPath = getSafePath(path.join(currentPath || '', folderName));
        await fs.mkdir(newFolderPath);
        res.status(201).json({ message: 'Folder created' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

// POST /api/files/text
router.post('/text', authenticateToken, async (req, res) => {
    try {
        const { currentPath, fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'File name required' });

        const safeFileName = fileName.endsWith('.txt') ? fileName : `${fileName}.txt`;
        const newFilePath = getSafePath(path.join(currentPath || '', safeFileName));
        
        await fs.writeFile(newFilePath, '', 'utf8');
        res.status(201).json({ message: 'File created' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create file' });
    }
});

// GET /api/files/read?path=...
router.get('/read', authenticateToken, async (req, res) => {
    try {
        const relativePath = req.query.path;
        if (!relativePath) return res.status(400).json({ error: 'Path required' });

        const targetPath = getSafePath(relativePath);
        
        const content = await fs.readFile(targetPath, 'utf8');
        res.json({ content });
    } catch (error) {
        console.error('Read file error:', error);
        res.status(500).json({ error: 'Failed to read file contents' });
    }
});

// PUT /api/files/update
router.put('/update', authenticateToken, async (req, res) => {
    try {
        const { filePath, content } = req.body;
        if (!filePath) return res.status(400).json({ error: 'File path required' });

        const targetPath = getSafePath(filePath);
        
        await fs.writeFile(targetPath, content || '', 'utf8');
        res.json({ message: 'File saved successfully' });
    } catch (error) {
        console.error('Save file error:', error);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// DELETE /api/files/delete
router.delete('/delete', authenticateToken, async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath) return res.status(400).json({ error: 'File path required' });

        const targetPath = getSafePath(filePath);
        
        // fs.rm with recursive handles both files and non-empty folders
        await fs.rm(targetPath, { recursive: true, force: true });
        res.json({ message: 'Deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// PUT /api/files/rename
router.put('/rename', authenticateToken, async (req, res) => {
    try {
        const { oldPath, newName } = req.body;
        if (!oldPath || !newName) return res.status(400).json({ error: 'Missing parameters' });

        const targetPath = getSafePath(oldPath);
        const dir = path.dirname(targetPath);
        const newTargetPath = path.join(dir, newName);
        
        // Ensure the new path doesn't escape the storage root
        if (!newTargetPath.startsWith(STORAGE_ROOT)) throw new Error('Out of bounds');

        await fs.rename(targetPath, newTargetPath);
        res.json({ message: 'Renamed successfully' });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ error: 'Failed to rename item' });
    }
});

// POST /api/files/copy
router.post('/copy', authenticateToken, async (req, res) => {
    try {
        const { sourcePath, destinationDir } = req.body;
        if (!sourcePath) return res.status(400).json({ error: 'Source path required' });

        const src = getSafePath(sourcePath);
        // Create the new path by placing the source file's name inside the destination directory
        const dest = getSafePath(path.join(destinationDir || '', path.basename(src)));

        // fs.cp handles copying both files and directories
        await fs.cp(src, dest, { recursive: true });
        res.json({ message: 'Copied successfully' });
    } catch (error) {
        console.error('Copy error:', error);
        res.status(500).json({ error: 'Failed to copy item' });
    }
});

// GET /api/files/download?path=...
// This serves the raw file directly (great for images, videos, and downloading)
router.get('/download', authenticateToken, (req, res) => {
    try {
        const relativePath = req.query.path;
        if (!relativePath) return res.status(400).json({ error: 'Path required' });

        const targetPath = getSafePath(relativePath);
        
        // res.sendFile automatically handles mime-types and binary streaming
        res.sendFile(targetPath);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// GET /api/files/export?path=...
router.get('/export', authenticateToken, async (req, res) => {
    try {
        const relativePath = req.query.path;
        if (!relativePath) return res.status(400).json({ error: 'Path required' });

        const targetPath = getSafePath(relativePath);
        const stat = await fs.stat(targetPath);

        if (stat.isDirectory()) {
            const zipName = `${path.basename(targetPath) || 'export'}.zip`;
            res.attachment(zipName);

            const archive = new ZipArchive({ zlib: { level: 9 } });

            archive.on('error', (err) => {
                console.error('Archive error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to export folder' });
                    return;
                }
                res.destroy(err);
            });

            archive.pipe(res);
            archive.directory(targetPath, false);
            await archive.finalize();
        } else {
            res.download(targetPath);
        }
    } catch (error) {
        console.error('Export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to export item' });
        }
    }
});

// PUT /api/files/move
router.put('/move', authenticateToken, async (req, res) => {
    try {
        const { sourcePath, destinationDir } = req.body;
        // destinationDir can be empty string for root, so we check strictly for undefined
        if (!sourcePath || destinationDir === undefined) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        const src = getSafePath(sourcePath);
        // Create the new path by placing the source file's name inside the destination directory
        const dest = getSafePath(path.join(destinationDir, path.basename(src)));

        // Ensure the new path doesn't escape the storage root
        if (!dest.startsWith(STORAGE_ROOT)) throw new Error('Out of bounds');

        await fs.rename(src, dest);
        res.json({ message: 'Moved successfully' });
    } catch (error) {
        console.error('Move error:', error);
        res.status(500).json({ error: 'Failed to move item' });
    }
});

module.exports = router;