// Routes index for tenant app
const express = require('express');
const router = express.Router();

// Welcome/Home page
router.get('/', (req, res) => {
    if (req.session && req.session.loggedIn && req.session.userType === 'tenant') {
        return res.redirect('/tenant/dashboard');
    }
    res.redirect('/tenant/login/form');
});

module.exports = router;
