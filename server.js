const express = require('express');
const session = require('express-session');
const path = require('path');
const { PORT, SERVER_SESSION_SECRET } = require('./config.js');

let app = express();

// Trust proxy for ngrok/reverse proxy environments
app.set('trust proxy', 1);

// Middleware for parsing JSON and URL-encoded bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files (using public directory for the integrated app)
app.use(express.static('public'));

// express-session middleware
app.use(session({
    secret: SERVER_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true, // Required for secure cookies behind proxy
    cookie: {
        httpOnly: true,
        secure: 'auto', // Secure if request is https
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// API Routes
app.use(require('./routes/auth.js'));
app.use(require('./routes/hubs.js'));
app.use(require('./routes/diff.js'));
app.use(require('./routes/clash.js'));
app.use(require('./routes/issues.js'));
app.use('/api/models', require('./routes/models.js'));
app.use('/api/ai', require('./routes/ai.js'));
app.use(require('./routes/memos.js'));

const { geocodeRouter } = require('./routes/tiles.js');
app.use(require('./routes/tiles.js'));
app.use(geocodeRouter);


// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err.message || err);
    res.status(err.statusCode || 500).json({
        error: err.message || 'Internal Server Error'
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}...`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
