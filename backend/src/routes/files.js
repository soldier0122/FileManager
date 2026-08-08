const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// 1. Read the path from .env. 
// 2. Fall back to a local 'storage' folder if the user forgot to set the variable.
// 3. Use path.resolve() to lock in the absolute path.
const STORAGE_ROOT = process.env.STORAGE_ROOT 
    ? path.resolve(process.env.STORAGE_ROOT) 
    : path.resolve(__dirname, '../../storage');

// GET /api/files - Lists all files and folders in the target directory
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Ensure the directory actually exists, create it if it doesn't
        await fs.mkdir(STORAGE_ROOT, { recursive: true });

        // Read the directory contents
        const items = await fs.readdir(STORAGE_ROOT, { withFileTypes: true });
        
        // Format the output
        const fileList = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory()
        }));

        // Sort folders first, then files alphabetically
        fileList.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name);
            }
            return a.isDirectory ? -1 : 1;
        });

        res.json({
            // Sending back the root path helps verify it's looking in the right place
            rootPath: STORAGE_ROOT, 
            files: fileList
        });
    } catch (error) {
        console.error('File system error:', error);
        res.status(500).json({ error: 'Failed to read the storage directory' });
    }
});

module.exports = router;