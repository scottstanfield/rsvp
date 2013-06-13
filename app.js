(function(){
    'use strict';

    var express = require('express');
    var http = require('http');
    var moment = require('moment');
    var redis = require('then-redis');
    var expressValidator = require('express-validator');
    var _ = require('underscore');

    // var SendGrid = require('sendgrid').SendGrid;
    var sendgrid = {};

    var withRedis = function(res, onRedisConnect) {
        var redisport = process.env.REDISTOGO_URL || 'tcp://127.0.0.1:6379';
        redis.connect(redisport).then(function(db) {
            onRedisConnect(db);
        }, function (error) {
            console.log('Failed to conenct to Redis: ' + error);
            res.render('500', { error: error });
        });
    };

    var redisport = 0;

    var app = express();
    app.configure(function() {
        app.set('port', process.env.PORT || 3000);

        app.set('views', __dirname + '/views');   // nomrally __dirname + '/views");
        app.set('view engine', 'jade');

        app.use(express.favicon());
        app.use(express.logger('dev'));
        app.use(express.compress());
        app.use(express.bodyParser());      // json, urlencode and multipart forms

        var options = {};
        app.use(expressValidator(options));

        app.use(express.methodOverride());
        app.use(express.static(__dirname + '/static'));

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
        console.log('in production mode');
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

    app.post('/', function(req, res) {
        req.checkBody('fullname', 'Name is required').notEmpty();
        req.checkBody('email', 'A valid email is required').isEmail();
        req.checkBody('code', 'An RSVP code is required').notEmpty();

        var errors = req.validationErrors();

        var fullname = res.locals.fullname = req.body.fullname;
        var email = res.locals.email = req.body.email;
        var code = res.locals.code = req.body.code;
        var renderMsg = function(alertType, msg){
            alertbox(res, alertType, msg);
            res.render('index');
        }

        // two keys:
        // 'codes' holds the available tickets like 'rds' or 'mvps'
        // 'rsvp'  holds the people that have RSVPd

        function doSomeStuffWithRsvps(rsvps) {
            withRedis(res, function(db) {
                db.hexists('rsvp', email).then(function(alreadyRegistered) {
                    if(alreadyRegistered) {
                        return renderMsg(Alert.info, 'You\'ve already registered, silly');
                    } else {
                        db.hexists('codes', code).then(function(codeIsGood) {
                            if(codeIsGood) {
                                db.hincrby('codes', code, -1).then(function(result) {
                                    if(result <= 0) {
                                        return renderMsg(Alert.warning, 'That RSVP code is no longer valid.');
                                    } else {
                                        db.hset('rsvp', email, JSON.stringify({ name: fullname, code: code }));
                                        return renderMsg(Alert.success, 'Your code is valid. Thanks for RSVPing!');
                                    }
                                }, function(err) {
                                    // do error
                                });
                            } else {
                                return renderMsg(Alert.warning, 'That RSVP code is not valid.');
                            }
                        }, function(){
                            // do error
                        });
                    }
                }, function() {
                    // do error
                });
            });
        }

        if (!errors) {
            doSomeStuffWithRsvps();

        } else {
            var e = _.map(errors, function(n) { return n.msg; });
            alertbox(res, Alert.error, 'Please correct the following:', e);
            return renderSuccess();
        }

    });

    // REDIS manipulation functions

    app.get('/initdb', function(req, res) {

        withRedis(res, function(db){
            db.set('rsvp:rds',  50);
            db.set('rsvp:mvps', 20);
            db.set('rsvp:devexpress', 6);

            res.send('initdb');
        });
    });

    app.get('/readdb', function(req, res) {
        var db = redis.createClient(app.get('redis-port'));

        db.keys('rsvp:*').then(function(keys) {
            return db.send('mget', keys);
        }).then(function(values) {
            res.send(values);
        });
    });

    // not working
    app.get('/hash', function(req, res) {
        // default to the 'rsvp' key
        res.redirect('/hash/rsvp');
    });


    app.post('/hash/:key/:field/:value', function(req, res) {
        var key = req.params.key;       
        var field = req.params.field;       
        var value = req.params.value;       

        withRedis(res, function(db){
            db.hset(key, field, value).then(function(result) {
                res.send(result);
            });
        });
    });

    app.delete('/hash/:key', function(req, res) {
        var key = req.params.key;       
        console.log('deleting: ' + key);

        withRedis(res, function(db){
            db.del(key).then(function(result) {
                res.send(result);
            });
        });
    });

    app.get('/hash/:key', function(req, res) {
        console.log('using REDIS:' + redisport);
        var key = req.params.key;       // skipping validity checks
        console.log(key);

        withRedis(res, function(db){
             db.hgetall(key).then(function(hash) {
                res.send(hash);
            });
        });
 
    });

    app.get('/readhash2', function(req, res) {
        withRedis(res, function(db){
            db.hgetall('rsvp').then(function(hash) {
                res.send(hash);
            });
        });
    });

    app.get('/readhash3', function(req, res) {
        db.hgetall('buckets').then(function(hash) {
            res.send(hash);
        });
    });

    app.get('/debug', function(req, res) {

        withRedis(res, function(db){
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

})();
