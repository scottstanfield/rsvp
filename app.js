var express = require('express');
var http = require('http');
var util = require('util');
var moment = require('moment');
var _ = require('underscore');

// var SendGrid = require('sendgrid').SendGrid;

var redis = require('then-redis');
var expressValidator = require('express-validator');

var app = express();

// MIDDLEWARE
//
app.configure(function() {
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + '/views');   // nomrally __dirname + "/views");
    app.set('view engine', 'jade');

    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(express.compress());
    app.use(express.bodyParser());      // json, urlencode and multipart forms

    var options = {};
    app.use(expressValidator(options));

    app.use(express.methodOverride());
    app.use(express.static(__dirname + '/static'));

    // app.use(function(req, res, next) {
    //     res.locals.email = 'cyndi'
    //     // res.locals.code = 'family2013';
    //     res.locals.fullname = 'Cyndi Stanfield';

    //     next();
    // });
    
    app.use(app.router);


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
    // sendgrid = new SendGrid(process.env.SENDGRID_USERNAME, process.env.SENDGRID_PASSWORD);
});

// app.locals is new in Express 3. Pre-initialize errors and message for use later.
app.locals.errors = {};
app.locals.message = {};

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
    res.render('index', {
        text: moment().format('dddd h:mm:ss a')
    });
});

var Alert = { success: 'success', info: 'info', warning: 'warning', error: 'error' };

function alertbox(res, a, m, e)
{
    var e = e || [];
    res.locals.alerts = {
        style: a,           // pick one from Alert
        msg: m,
        errors: e
    };
}

app.get('/test', function(req, res) {
    alertbox(res, Alert.success, 'hello there message', ['one', 'two']);
    res.locals.errorText = 'hello from messages';
    res.render('test');
});

app.post('/rsvp', function(req, res) {
    console.log('inside rsvp');

    console.log('fullname: ' + req.body.fullname);
    console.log('email: ' + req.body.email);
    console.log('code: ' + req.body.code);

    req.checkBody('fullname', 'Name is required').notEmpty();
    req.checkBody('email', 'A valid email is required').isEmail();
    req.checkBody('code', 'An RSVP code is required').notEmpty();

    var errors = req.validationErrors();

    if (!errors) {
        alertbox(res, Alert.success, 'Your code is valid. Thanks for RSVPing!');
    } else {
        var e = _.map(errors, function(n) { return n.msg; });
        alertbox(res, Alert.error, 'Please correct the following:', e);
    }

    res.locals.fullname = req.body.fullname;
    res.locals.code = req.body.code;
    res.locals.email = req.body.email;

    res.render('index');
});

app.get('/rsvp', function(req, res) {
    res.redirect('/');
});



// debug

app.get('/debug', function(req, res) {

    redis.connect().then(function (db) {
        db.get('rsvp:rds').then(function(value) {
            var answer = '';
            answer += 'Your IP: ' + req.ip + '\n';
            answer += 'Request URL: ' + req.url + '\n';
            answer += 'Request type: ' + req.method + '\n';
            // answer += 'Request headers: ' + JSON.stringify(req.headers) + '\n';
            //

            if (value <= 0)
                answer += 'redis: no more invites left ' + value.toString();
            else
                answer += 'redis: ' + value.toString();

            res.end(answer);
        });
    }, function (error) {
            console.log('connection REDIS ERROR: ' + error);
            res.end('redis connection error');
    });
});

app.get('/about', function(req, res) {
    res.end('About us');
});

app.get('/hello/:who', function(req, res) {
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
  console.log('Express server listening on port ' + app.get('port'));
});

