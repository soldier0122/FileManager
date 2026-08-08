const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined in .env");
    process.exit(1);
}

// GET /api/auth/setup-status
// Checks if the database has any users to determine if we show Register or Login
router.get('/setup-status', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ needsSetup: row.count === 0 });
    });
});

// POST /api/auth/register
router.post('/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // SECURITY LOCK: Only allow registration if no users exist
    db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        if (row.count > 0) {
            return res.status(403).json({ error: 'Admin account already exists. Registration locked.' });
        }

        try {
            // Hash the password with a salt round of 10
            const hashedPassword = await bcrypt.hash(password, 10);

            // Insert into the relational SQL database
            db.run(
                'INSERT INTO users (username, password_hash) VALUES (?, ?)', 
                [username, hashedPassword], 
                function(err) {
                    if (err) return res.status(500).json({ error: 'Database error' });
                    res.status(201).json({ message: 'User registered successfully', userId: this.lastID });
                }
            );
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Retrieve the user from the database
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        // Compare the provided password with the stored hash
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        // Generate a JWT valid for 24 hours
        const token = jwt.sign(
            { userId: user.id, username: user.username }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        res.json({ message: 'Login successful', token, username: user.username });
    });
});

module.exports = router;