const express = require('express');
const router = express.Router();
const {User, Event, EventAdmin, Guest} = require('../models');
const util = require('../utils');
const code = util.code;


masterCheck = async function(userId, eventId) {
    const check = await Event.findOne({
        where: {user_id: userId, id: eventId}
    });    
    return check !== null;
}

guestCheck = async function(userId, eventId) {
    const check = await Guest.findOne({
        where: {user_id: userId, event_id: eventId}
    });
    return check !== null;
}

// TO-DO : Solve Option Problem
router.options('/', function(req, res) {
    return res.send({});
});

router.all('/*', function(req, res, next) {
    const result = util.getUser(req);
    if(result.user === undefined) {
        res.status(401).json('no auth');
        return;
    }
    res.locals.user = result.user;
    next();
});

// post1 : check phonenubmer
router.post('/', async function(req, res, next) {
    const responseJson = {};
    const eventAdmin = req.body.eventAdmin;
    const admin = [];

    for(let i = 0; i < eventAdmin.length; i++) {
        if(util.phoneNumberCheck(eventAdmin[i])) {
            const adminResult = await User.findOne(
                {where: {phone_number: eventAdmin[i]}},
            );

            if(adminResult == null) {
                admin.push({user_id: null, user_phone: eventAdmin[i]});
            } else {
                admin.push({user_id: adminResult.id, user_phone: eventAdmin[i]});
            }
        } else {
            responseJson.result = code.PHONE_NUMBER_INVALID;
            responseJson.detail = 'phone number invalid';
            res.json(responseJson);
            return;
        }
    }
    res.locals.admins = admin;
    next();
});

// post2 : event insert
router.post('/', async function(req, res, next) {
    const responseJson = {};
    const body = req.body;
    try {
        const result = await Event.create(
            {
                user_id: res.locals.user.id,
                category: body.category,
                title: body.title,
                location: body.location,
                body: body.body,
                invitation_url: body.invitationUrl,
                start_datetime: body.startDatetime,
                end_datetime: body.endDatetime,
                is_activate: true,
            },
        );
        console.dir(result);
        const eventId = result.dataValues.id;
        for(let i = 0; i < res.locals.admins.length; i++) {
            res.locals.admins[i].event_id = eventId;
        }
        next();
    } catch(exception) {
        console.log(exception);
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error1';
        res.json(responseJson);
    }
});

// post3 : eventadmin insert
router.post('/', async function(req, res, next) {
    const responseJson = {};
    const admins = res.locals.admins;

    try {
        const result = await EventAdmin.bulkCreate(admins);

        responseJson.result = code.SUCCESS;
        responseJson.detail = 'success';
    } catch(exception) {
        console.log(exception);
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error2';
    } finally {
        res.json(responseJson);
    }
});

router.put('/', async function(req, res, next) {
    const responseJson = {};
    const body = req.body;

    try {
        const result = await Event.update(
            {
                title: body.title,
                location: body.location,
                body: body.body,
                invitation_url: body.invitation_url,
                start_datetime: body.startDatetime,
                end_datetime: body.endDatetime,
            },
            {
                where: {
                    id: body.id,
                }},
        );
        responseJson.result = code.SUCCESS;
        responseJson.detail = 'success';
    } catch(exception) {
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
    } finally {
        res.json(responseJson);
    }
});

router.delete('/:id', async function(req, res, next) {
    const responseJson = {};
    try {
        const result = await Event.destroy(
            {where: {id: req.params.id}},
        );

        const adminResult = await EventAdmin.destroy(
            {where: {event_id: req.params.id}},
        );

        responseJson.result = code.SUCCESS;
        responseJson.detail = 'success';
    } catch(exception) {
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
    } finally {
        res.json(responseJson);
    }
});

router.get('/', async function(req, res, next) {
    const responseJson = {};
    try {
        const is_host = req.query.host;
        if(typeof is_host === 'undefined') {
            responseJson.result = code.INVALID_QUERY;
            responseJson.detail = 'params error';    
        } else if(is_host === 'true') {
            const result = await Event.findAll(
                {
                    where: {user_id: res.locals.user.id},
                    order: [
                        ['is_activate', 'DESC'],
                        ['end_datetime', 'DESC'],
                    ],
                },
            );
            responseJson.result = code.SUCCESS;
            responseJson.detail = 'success';
            responseJson.data = result;
        } else {
            const result = await Event.findAll({
                include: [{
                    model: Guest,
                    where: {user_id: res.locals.user.id},
                }],
                order: [
                    ['is_activate', 'DESC'],
                    ['end_datetime', 'DESC'],
                ],
            });
            responseJson.result = code.SUCCESS;
            responseJson.detail = 'success';            
            responseJson.data = result;
        }
    } catch(exception) {
        console.log(exception);
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
    } finally {
        res.json(responseJson);
    }
});

router.get('/:id', async function(req, res, next) {
    const responseJson = {};
    const myId = res.locals.user.id;
    try {
        const eventId = req.params.id;
        const result = await Event.findOne(
            {where: {id: eventId}},
        );

        if (result === null) {
            responseJson.result = code.NO_DATA;
            responseJson.detail = 'cannot find eventData';
        } else {
            
            let haveAuth = result.dataValues.user_id === myId;
            if(!haveAuth) {
                if(await guestCheck(myId,eventId)) {
                    haveAuth = true;
                }
            }
            if(haveAuth) {
                const data = result.dataValues;
                const result2 = await EventAdmin.findAll(
                    {
                        attributes: ['user_phone'],
                        where: {event_id: eventId}
                    },
                );
                data.eventAdmin = result2;
                responseJson.result = code.SUCCESS;
                responseJson.detail = 'success';            
                responseJson.data = data;
            }
            else {
                responseJson.result = code.NO_AUTH;
                responseJson.detail = 'no_auth'
            }
        }
    } catch(exception) {
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
        console.log(exception);
    } finally {
        res.json(responseJson);
    }
});



// event close
router.put('/close/:id', async function(req, res, next) {
    const responseJson = {};
    const eventId = req.params.id;    
    const myId = res.locals.user.id;
    try {
        if(await masterCheck(myId, eventId)) {
            const result = await Event.update(
                {
                    is_activated: false,
                },
                {
                    where: {
                        id: eventId,
                    },
                },
            );
            responseJson.result = code.SUCCESS;
            responseJson.detail = 'success';
        } else {
            responseJson.result = code.NO_AUTH;
            responseJson.detail = 'no_auth'
        }
    } catch(exception) {
        console.log(exception);
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
    } finally {
        res.json(responseJson);
    }
});

module.exports = router;
