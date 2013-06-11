var express = require('express');
var http = require('http');
var RedisStore = require('connect-redis')(express);
var db = require('redis').createClient();

var Validator = require('validator').Validator
var SendGrid = require('sendgrid').SendGrid

var app = express();

var SITE_SECRET = 'canihazabucket';

// MIDDLEWARE
//
app.configure(function() {
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + "/views");   // nomrally __dirname + "/views");
    app.set('view engine', 'jade');

    // app.use(express.cookieParser(SITE_SECRET));
    // app.use(express.session({ store: new RedisStore({ client: db}) }));

    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(express.compress());
    app.use(express.bodyParser());      // json, urlencode and multipart forms
    app.use(express.methodOverride());
    app.use(express.static(__dirname + '/static'));
    app.use(app.router);
    // app.use(express.csrf());

    app.use(myErrorHandler);
});

app.configure('development', function() {
    app.locals.pretty = true;           // jade will render nice HTML
    sendgrid = {
        send: function(opts, cb) {
            console.log('Email:', opts);
            cb(true, opts);
        }
    };
});

app.configure('production', function() {
    app.use(express.errorHandler());
    sendgrid = new SendGrid(process.env.SENDGRID_USERNAME, process.env.SENDGRID_PASSWORD);
});

// new in Express 3
app.locals.errors = {};
app.locals.message = {};

function csrf(req, res, next) {
    res.locals.token = req.session._csrf;
    next();
}

function validate(message) {
    var v = new Validator();
    var errors = [];

    v.error = function(msg) {
        errors.push(msg);
    }

    v.check(message.name, 'Enter your name').len(1, 100);
    v.check(message.email, 'Enter a valid email').isEmail();
    v.check(message.message, 'Enter a valid message').len(1, 1000);

    return errors;
}

function sendEmail(message, fn) {
    sendgrid.send( {
        to: process.env.EMAIL_RECIPIENT,
        from: message.email,
        subject: 'Contact message',
        text: message.message
    }, fn);
}

// ROUTES
//
app.get('/', function(req, res) {
    
    res.render('index', { message: 'I love Farrah Fawcett hair' });
});

app.post('/contact', csrf, function(req, res) {
    var message = req.body.message,
        errors = validate(message), 
        locals = {};

    function render() {
        res.render('index', locals);
    }

    if (errors.length === 0) {
        sendEmail(message, function(success) {
            if (!success) {
                locals.error = 'Error sending message';
                locals.message = message;
            } else {
                locals.notice = 'Your message has been sent.';
            }
            render();
        });
    } else {
        locals.error = 'Your message has errors:';
        locals.errors = errors;
        locals.message = message;
        render();
    }
});

app.get('/contacts', function(req, res) {
    res.redirect('/');
});

db.on("error", function(err) {
    console.log("REDIS ERROR: " + err);
});

app.get('/debug', csrf, function(req, res) {
    db.decr("rsvp:rds", function(err, reply) {

        var answer = '';
        answer += 'Your IP: ' + req.ip + '\n';
        answer += 'Request URL: ' + req.url + '\n';
        answer += 'Request type: ' + req.method + '\n';
        answer += 'Request headers: ' + JSON.stringify(req.headers) + '\n';

        answer += 'redis: ' + reply.toString();

        res.end(answer);
    });
});

app.get('/about', function(req, res) {
    res.end('About us');
});

app.get('/hello/:who', csrf, function(req, res) {
    res.end('Hello there, ' + req.params.who + '.');
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
  console.log("Express server listening on port " + app.get('port'));
});

