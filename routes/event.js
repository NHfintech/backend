const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {sequelize, User, Event, EventAdmin, Guest} = require('../models');
const util = require('../utils');
const code = util.code;


masterCheck = async function(userId, eventId) {
    const check = await Event.findOne({
        where: {user_id: userId, id: eventId},
    });
    return check !== null;
};

guestCheck = async function(userId, eventId) {
    const check = await Guest.findOne({
        where: {user_id: userId, event_id: eventId},
    });
    return check !== null;
};

adminCheck = async function(userId, eventId) {
    const check = await EventAdmin.findOne({
        where: {user_id: userId, event_id: eventId},
    });
    return check !== null;
};

getUserByPhone = async function(phone) {
    let resJson = null;
    const admin = [];
    for (let i = 0; i < phone.length; i++) {
        if (util.phoneNumberCheck(phone[i])) {
            const adminResult = await User.findOne(
                {where: {phone_number: phone[i]}},
            );

            if (adminResult == null) {
                admin.push({user_id: null, user_phone: phone[i]});
            }
            else {
                admin.push({
                    user_id: adminResult.id,
                    user_phone: phone[i],
                });
            }
        }
        else {
            resJson = {};
            resJson.result = code.PHONE_NUMBER_INVALID;
            resJson.detail = 'phone number invalid';
            break;
        }
    }
    return {
        responseJson: resJson,
        admin: admin,
    };
};

// post1 : check phonenubmer
router.post('/', async function(req, res, next) {
    const eventAdmin = req.body.eventAdmin;

    const {responseJson, admin} = await getUserByPhone(eventAdmin);

    if(responseJson) {
        res.json(responseJson);
        return;
    }
    res.locals.admins = admin;
    next();
});


// post2 : event insert
router.post('/', async function(req, res, next) {
    const responseJson = {};
    const body = req.body;
    const myId = res.locals.user.id;
    const admins = res.locals.admins;
    const transaction = await sequelize.transaction();
    try {
        const result = await Event.create(
            {
                user_id: myId,
                category: body.category,
                title: body.title,
                location: body.location,
                body: body.body,
                invitation_url: body.invitationUrl,
                event_datetime: body.eventDatetime,
                is_activated: true,
            },
            {transaction},
        );
        const eventId = result.dataValues.id;
        res.locals.eventId = eventId;
        res.locals.title = result.dataValues.title;
        res.locals.eventDatetime = result.dataValues.event_datetime;

        for(let i = 0; i < admins.length; i++) {
            admins[i].event_id = eventId;
        }
        const encrypt = crypto.createHash('sha256').update(eventId + ' ').digest('hex');
        const updateResult = await Event.update(
            {
                event_hash: encrypt,
            },
            {
                where: {
                    id: eventId,
                },
                transaction,
            },
        );

        // event admin insert
        const result2 = await EventAdmin.bulkCreate(admins, {transaction});

        const userAdmin = [];
        const noUserAdmin = [];

        for(let i = 0; i < result2.length; i++) {
            const temp = result2[i].dataValues;
            if(temp.user_id === null) {
                noUserAdmin.push(temp.user_phone);
            }
            else if(temp.user_id !== myId) {
                userAdmin.push(temp.user_id);
            }
        }
        const eventAdmins = {
            user: userAdmin,
            noUser: noUserAdmin,
        };

        res.locals.adminIds = eventAdmins;
        await transaction.commit();
        next();
    }
    catch(exception) {
        console.log(exception);
        if (transaction) {
            await transaction.rollback();
        }
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'event create db error';
        res.json(responseJson);
    }
});

// sendFcm or sms
router.post('/', async function(req, res, next) {
    const responseJson = {};
    const adminIds = res.locals.adminIds;
    try {
        const result = await User.findAll(
            {
                where: {
                    id: adminIds.user,
                },
                attributes: ['id', 'phone_number', 'firebase_token'],
            },
        );

        const fbTokens = [];
        for(let i = 0; i < result.length; i++) {
            const temp = result[i].dataValues.firebase_token;
            if(temp != null) {
                fbTokens.push(temp);
            }
            else {
                adminIds.noUser.push(result[i].dataValues.phone_number);
            }
        }

        const title = res.locals.title;
        const content = res.locals.title + '의 관리자로 초대되었습니다.';

        if(fbTokens.length !== 0) {
            const fcm = await util.sendFcm(
                title,
                content,
                '서버주소/event/' + res.locals.eventId,
                fbTokens,
            );
        }

        // TODO : admins.noUser = 회원가입 안된 사람들 문자로
        if(adminIds.noUser.length !== 0) {
            const sms = await util.sendSms(
                adminIds.noUser,
                content,
            );
        }

        responseJson.result = code.SUCCESS;
        responseJson.detail = 'success';
        responseJson.data = {id: res.locals.eventId};
    }
    catch(exception) {
        console.log(exception);
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error3';
    }
    finally {
        res.json(responseJson);
    }
});

router.put('/:id', async function(req, res, next) {
    const responseJson = {};
    const body = req.body;
    const userId = res.locals.user.id;
    const eventId = req.params.id;

    try {
        if(await masterCheck(userId, eventId)) {
            const {resJson, admin} = await getUserByPhone(body.eventAdmin);

            if(resJson) {
                res.json(resJson);
                return;
            }

            for(let i = 0; i < admin.length; i++) {
                admin[i].event_id = eventId;
            }

            const result = await Event.update(
                {
                    title: body.title,
                    location: body.location,
                    body: body.body,
                    invitation_url: body.invitationUrl,
                    event_datetime: body.eventDatetime,
                },
                {
                    where: {
                        id: eventId,
                    }},
            );

            for(let i = 0; i < admin.length; i++) {
                await EventAdmin.findOrCreate(
                    {
                        where: {
                            user_id: admin[i].user_id,
                            event_id: admin[i].event_id,
                            user_phone: admin[i].user_phone,
                        },
                    },
                );
            }

            responseJson.result = code.SUCCESS;
            responseJson.detail = 'success';
        }
        else {
            responseJson.result = code.NO_AUTH;
            responseJson.detail = 'no auth';
        }
    }
    catch(exception) {
        console.log(exception);
        responseJson.result = code.DB_ERROR;
        responseJson.detail = 'event or eventadmin update error';
    }
    finally {
        res.json(responseJson);
    }
});

router.delete('/:id', async function(req, res, next) {
    const responseJson = {};
    const eventId = req.params.id;
    const myId = res.locals.user.id;
    const transaction = await sequelize.transaction();
    try {
        if(await masterCheck(myId, eventId)) {
            const result = await Event.destroy(
                {where: {id: eventId}, transaction},
            );
            const adminResult = await EventAdmin.destroy(
                {where: {event_id: eventId}, transaction},
            );
            await transaction.commit();
            responseJson.result = code.SUCCESS;
            responseJson.detail = 'success';
        }
        else {
            responseJson.result = code.NO_AUTH;
            responseJson.detail = 'no auth';
        }
    }
    catch(exception) {
        if (transaction) {
            await transaction.rollback();
        }
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'event delete error';
    }
    finally {
        res.json(responseJson);
    }
});

router.get('/', async function(req, res, next) {
    const responseJson = {};
    try {
        const isHost = req.query.host;
        if(typeof isHost === 'undefined') {
            responseJson.result = code.INVALID_QUERY;
            responseJson.detail = 'params error';
        }
        else if(isHost === 'true') {
            const result1 = await Event.findAll(
                {
                    where: {user_id: res.locals.user.id},
                    order: [
                        ['is_activated', 'DESC'],
                        ['event_datetime', 'DESC'],
                    ],
                },
            );
            const result2 = await Event.findAll({
                include: [{
                    model: EventAdmin,
                    where: {user_id: res.locals.user.id},
                }],
                order: [
                    ['is_activated', 'DESC'],
                    ['event_datetime', 'DESC'],
                ],
            });
            const result=[];
            for(let i = 0; i < result1.length; i++) {
                result.push(result1[i].dataValues);
            }
            for(let i = 0; i < result2.length; i++) {
                result.push(result2[i].dataValues);
            }
            result.sort(function(a, b) {
                if(a.is_activated >= b.is_activated) {
                    if(a.event_datetime > b.event_datetime) {
                        return -1;
                    }
                    else if(a.event_datetime === b.event_datetime) {
                        return 0;
                    }
                    else {
                        return 1;
                    }
                }
                else {
                    return 1;
                }
            });
            responseJson.result = code.SUCCESS;
            responseJson.detail = 'success';
            responseJson.data = result;
        }
        else {
            const result = await Event.findAll({
                include: [{
                    model: Guest,
                    where: {user_id: res.locals.user.id},
                }],
                order: [
                    ['is_activated', 'DESC'],
                    ['event_datetime', 'DESC'],
                ],
            });
            responseJson.result = code.SUCCESS;
            responseJson.detail = 'success';
            responseJson.data = result;
        }
    }
    catch(exception) {
        console.log(exception);
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
    }
    finally {
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
        }
        else {
            const data = result.dataValues;
            if(result.dataValues.user_id === myId) {
                data.userType = 'master';
            }
            else {
                if(await adminCheck(myId, eventId)) {
                    data.userType = 'admin';
                }
                else if(await guestCheck(myId, eventId)) {
                    data.userType = 'guest';
                }
            }
            if(typeof data.userType !== 'undefined') {
                const result2 = await EventAdmin.findAll(
                    {
                        attributes: ['user_phone'],
                        where: {event_id: eventId},
                    },
                );
                data.eventAdmin = result2;
                responseJson.result = code.SUCCESS;
                responseJson.detail = 'success';
                responseJson.data = data;
            }
            else {
                responseJson.result = code.NO_AUTH;
                responseJson.detail = 'no_auth';
            }
        }
    }
    catch(exception) {
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
        console.log(exception);
    }
    finally {
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
        }
        else {
            responseJson.result = code.NO_AUTH;
            responseJson.detail = 'no_auth';
        }
    }
    catch(exception) {
        console.log(exception);
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
    }
    finally {
        res.json(responseJson);
    }
});

router.get('/invite/:hash', async function(req, res, next) {
    const responseJson = {};
    const myId = res.locals.user.id;
    try {
        const hostId = req.query.hostId;
        const hash = req.params.hash;

        const result = await Event.findOne({
            attributes: ['id', 'user_id'],
            where: {event_hash: hash},
        });

        if (result === null) {
            responseJson.result = code.NO_DATA;
            responseJson.detail = 'cannot find event_hash';
        }
        else {
            const eventId = result.dataValues.id;
            const hostCheck = result.dataValues.user_id == hostId || await adminCheck(hostId, eventId);
            if(hostCheck) {
                const data = {event_id: eventId};
                if(result.dataValues.user_id == myId) {
                    data.userType = 'master';
                }
                else {
                    if(await adminCheck(myId, eventId)) {
                        data.userType = 'admin';
                    }
                    else {
                        data.userType = 'guest';
                    }
                }
                if(data.userType === 'guest') {
                    const result2 = await Guest.findOrCreate({
                        where: {
                            user_id: myId,
                            event_id: eventId,
                            eventAdmin_id: hostId,
                        },
                    });
                }
                responseJson.result = code.SUCCESS;
                responseJson.detail = 'success';
                responseJson.data = data;
            }
            else {
                responseJson.result = code.NO_AUTH;
                responseJson.detail = 'no_auth : hostId is not valid';
            }
        }
    }
    catch(exception) {
        responseJson.result = code.UNKNOWN_ERROR;
        responseJson.detail = 'unknown error';
        console.log(exception);
    }
    finally {
        res.json(responseJson);
    }
});

module.exports = router;
