const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

const STORAGE_ROOT = process.env.STORAGE_ROOT 
    ? path.resolve(process.env.STORAGE_ROOT) 
    : path.resolve(__dirname, '../../storage');

// Helper to safely resolve and validate paths
const getSafePath = (userPath) => {
    const targetPath = path.resolve(STORAGE_ROOT, userPath || '');
    // Crucial Security: Ensure the resolved path starts with the designated root
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
        await fs.mkdir(targetPath, { recursive: true });

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
        await fs.mkdir(newFolderPath, { recursive: true });
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
        await fs.mkdir(path.dirname(newFilePath), { recursive: true });
        await fs.writeFile(newFilePath, 'New empty text file.', 'utf8');
        res.status(201).json({ message: 'File created' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create file' });
    }
});

module.exports = router;