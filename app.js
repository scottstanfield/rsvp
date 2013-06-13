(function(){
    'use strict';

    var express = require('express');
    var http = require('http');
    var moment = require('moment');
    var redis = require('then-redis');
    var expressValidator = require('express-validator');

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
   });

    app.configure('production', function() {
        console.log('in production mode');
        app.use(express.errorHandler());
    });

    // app.locals is new in Express 3. Pre-initialize errors and message for use later.
    app.locals.errors = {};
    app.locals.message = {};

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

        var reallyBadError = function(){
            renderMsg(Alert.error, "Something really wrong happened :(");
        }

        // two keys:
        // 'codes' holds the available tickets like 'rds' or 'mvps'
        // 'rsvp'  holds the people that have RSVPd

        if (!errors) {
            withRedis(res, function(db) {

                // check if user already rsvp'd
                db.hexists('rsvp', email).then(function(alreadyRegistered) {
                    if(alreadyRegistered) {
                        return renderMsg(Alert.info, 'You\'ve already registered, silly');
                    }

                    // check if the specific rsvp code exists
                    db.hexists('codes', code).then(function(codeIsGood) {
                        if(!codeIsGood) {
                            return renderMsg(Alert.error, 'That RSVP code is not valid.');
                        }

                        // decrement the supplied code
                        db.hincrby('codes', code, -1).then(function(result) {
                            if(result <= 0) {
                                return renderMsg(Alert.warning, 'That RSVP code is no longer valid.');
                            }

                            // successfully decremented and we have a valid partier
                            // save the registered partier's name
                            db.hset('rsvp', email, JSON.stringify({ name: fullname, code: code })).then(function(){
                                return renderMsg(Alert.success, 'Your code is valid. Thanks for RSVPing!');
                            }, reallyBadError);
                        }, reallyBadError);
                    }, reallyBadError);
                }, reallyBadError);
            });
         } else {
            var e = errors.map(function(n) { return n.msg; });
            alertbox(res, Alert.error, 'Please correct the following:', e);
            return res.render('index');
        }

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
