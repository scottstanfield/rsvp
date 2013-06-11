var express = require('express');
var http = require('http');

var expressValidator = require('express-validator');

var app = express();

// MIDDLEWARE
//
app.configure(function() {
    app.set('port', process.env.PORT || 3000);

    app.use(express.logger('dev'));
    app.use(express.bodyParser());      // json, urlencode and multipart forms
    app.use(expressValidator);
    app.use(express.methodOverride());
    app.use(app.router);

    app.use(myErrorHandler);
});


// ROUTES
//
app.get('/', function(req, res) {
    res.send('hello');
});

app.post('/rsvp', function(req, res) {
    req.assert('name', 'Name is required').notEmpty();
    req.assert('email', 'A valid email is required').isEmail();
    req.assert('code', 'An RSVP code is required').notEmpty();

    var errors = req.validationErrors();
    var locals;
    if (!errors) {
        locals.notice = 'Your code is valid. Thanks for RSVPing!'
    } else {
        locals.error = 'Error processing form';
        locals.message = errors;
    }
    res.render('/index', locals);
});


app.get('/error', function(req, res) {
    res.render('500', { error: req });
});

// since this is the last non-error-handling middle use()'d,
// we assume it's a 404, as nothing else repsonded

app.get('*', function(req, res) {
    res.status(404).end('Page not found.');
});

// ERROR HANDLING
//
function myErrorHandler(err, req, res, next) {
    console.error(err.stack);
    res.status(500).render('500', { error: err });
}

// LAUNCH THE SERVER
// 
http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});

