require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const sha256 = require('js-sha256');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    new transports.File({ filename: 'error.log', level: 'error' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

var transporter = mailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'matcha.ccliffor@gmail.com',
    pass: '55p@&pp9JLjJ7oS@'
  }
});

var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'resources/images/')
  },
  filename: function (req, file, cb) {
    cb(null, uuidv4() + path.extname(file.originalname))
  }
});

var upload = multer({ storage: storage });

// TODO: implement tokenKey
// const { tokenKey } = require('./key');

const {
  db,
  dbUsers,
  dbUserProfiles,
  dbLikes,
  dbMatches,
  dbChatMessages,
  dbBlocked,
  dbGenders,
  dbSexualities,
  dbInterests,
  dbUserInterests,
  dbImages,
  dbTokens
} = require('./databaseSetup');
const { Validation } = require('./validation/validation');

const app = express();

const {
  PORT,
  DOWNSTREAM_URI
} = process.env;

var corsOptions = {
  origin: `${DOWNSTREAM_URI}`,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}

app.use(express.static('resources/images/'));
app.use(session({
  secret: 'anime tiddies',
  httpOnly: true,
  resave: true,
  saveUninitialized: false
}));
app.use(cors(corsOptions));
app.use(express.static(__dirname + '../app/public/index.html'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Registration */
app.post('/registration', async (req, res) => {
  const userData = req.body;

  if (!(Validation.isValidUsername(userData.username)
    && Validation.isValidEmail(userData.email)
    && Validation.isValidPassword(userData.password)
    && Validation.isValidFirstName(userData.firstName)
    && Validation.isValidLastName(userData.lastName))) {

    res.status(400).json({ message: 'Invalid user information' });

    return;
  }

  try {
    var username = await db.any(dbUsers.validate.username, userData.username);

    if (username[0] && username[0].id) {
      res.status(400).json({ message: 'Username already exists' });
      return;
    }

    email = await db.any(dbUsers.validate.email, userData.email);

    if (email[0] && email[0].id) {
      res.status(400).json({ message: 'Email address already in use' });

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting username and email',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing techincal difficulties right now' });

    return;
  }

  const hashedPassword = sha256(userData.password);

  try {
    const user = await db.one(dbUsers.create,
      [
        userData.firstName,
        userData.lastName,
        userData.username,
        userData.email,
        hashedPassword
      ]
    );

    const token = await db.one(dbTokens.create, userData.email);

    transporter.sendMail({
      from: 'matcha.ccliffor@gmail.com',
      to: userData.email,
      subject: 'Verify Account',
      html: `
        <h2>Welcome to Matcha!</h2>
        <h4>Click the link below to verify your new account</h4>
        <a href='${DOWNSTREAM_URL}:${DOWNSTREAM_PORT}/verify-email/${token.id}'>
          ${DOWNSTREAM_URL}:${DOWNSTREAM_PORT}/verify-email/${token.id}
        </a>
      `
    });

    res.status(201).json({ userId: user.id });

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting user',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
});

/* Verify Email */
app.post('/verify-email', async (req, res) => {
  const userData = req.body;

  try {
    const token = await db.one(dbTokens.select, userData.token);

    if (!token) {
      res.status(400).send('Invalid token');
    }

    const user = await db.one(dbUsers.selectOnEmail, token.email);

    await db.none(dbUsers.verify, user.id);

    await db.none(dbTokens.remove, token.id);

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error logging user in',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
});

/* Login */
app.post('/login', async (req, res) => {
  const userData = req.body;
  const hashedPassword = sha256(userData.password);

  userData.password = '';

  try {
    const user = await db.oneOrNone(dbUsers.authenticate,
      [
        userData.username,
        hashedPassword
      ]
    );

    if (user === null) {
      res.status(401).send('Invalid credentials');

      return;
    } else {
      req.session.userId = user.id;

      res.status(200).send();

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error logging user in',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
});

/* Logout */
app.get('/logout', async (req, res) => {
  if (!req.session.userId) {
    res.status(200).send();

    return;
  }

  try {
    req.session.destroy();

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error logging user out',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
});

/* Forgot Password */
app.post('/forgot-password', async (req, res) => {
  const userData = req.body;

  if (!Validation.isValidEmail(userData.email)) {
    res.status(400).send('Invalid email address');
  }
  try {
    const token = await db.one(dbTokens.create, userData.email);

    await transporter.sendMail({
      from: 'matcha.ccliffor@gmail.com',
      to: userData.email,
      subject: 'Password Reset',
      html: `
        <h4>Click the link below to reset your password</h4>
        <a href='${DOWNSTREAM_URL}:${DOWNSTREAM_PORT}/reset-password/${token.id}'>
          ${DOWNSTREAM_URL}:${DOWNSTREAM_PORT}/reset-password/${token.id}
        </a>
      `
    });

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error retrieving user data',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Reset Password */
app.post('/reset-password', async (req, res) => {
  const userData = req.body;

  try {
    const token = await db.one(dbTokens.select, userData.token);

    if (!token) {
      res.status(400).send('Invalid token');
    }

    if (!Validation.isValidPassword(userData.newPassword)) {
      res.status(400).send('Invalid password');

      return;
    }

    if (userData.newPassword !== userData.confirmPassword) {
      res.status(400).send('Passwords do not match');

      return;
    }

    const user = await db.one(dbUsers.selectOnEmail, token.email);

    await db.none(dbUsers.updatePassword, [user.id, sha256(userData.newPassword)]);

    await db.none(dbTokens.remove, userData.token);

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error resetting password',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Authenticate */
app.get('/authenticate', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  } else {
    res.status(200).send(req.session.userId);

    return;
  }
});

/* Change User Password */
app.put('/user/password', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const oldPassword = sha256(req.body.oldPassword);
  let newPassword = req.body.newPassword;
  let confirmPassword = sha256(req.body.confirmPassword);

  try {
    const currentPassword = await db.oneOrNone(dbUsers.selectPassword, req.session.userId);

    if (oldPassword !== currentPassword.hashed_password) {
      res.status(400).send('Your old password is incorrect');
      return;
    }

    if (!Validation.isValidPassword(newPassword)) {
      res.status(400).send('New password is invalid');
      return;
    }

    newPassword = sha256(newPassword);

    if (newPassword !== confirmPassword) {
      res.status(400).send('New passwords do not match');
      return;
    }

    await db.none(dbUsers.updatePassword, [req.session.userId, newPassword]);

    res.status(200).send();
    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error changing password',
      error: e
    });

    res.status(500).send();

    return;
  }
});

/* Get User Info */
app.get('/user', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();
    return;
  }

  const userId = req.query.userId
    ? req.query.userId
    : req.session.userId;

  try {
    const user = await db.oneOrNone(dbUsers.select, userId);

    if (user === null) {
      res.status(400).send();

      return;
    }

    res.status(200).json({
      userId: userId,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name
    });

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error retrieving user data',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get User Verification Status */
app.get('/verified', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();
    return;
  }

  try {
    const user = await db.one(dbUsers.getVerificationStatus, req.session.userId);

    if (!user) {
      res.status(400).send();

      return;
    }

    res.status(200).json({ verified: user.verified });

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error validating user',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
})

/* Update User Info */
app.put('/user', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();
    return;
  }

  userData = req.body;

  if (!(Validation.isValidFirstName(userData.firstName)
    && Validation.isValidLastName(userData.lastName)
    && Validation.isValidUsername(userData.username))) {

    res.status(400).send("Invalid user details");

    return;
  }

  try {
    const user = await db.oneOrNone(dbUsers.selectOnUsername, userData.username);

    if (user !== null && user.id !== req.session.userId) {
      res.status(400).send("Username already in use");

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error validating user',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }

  try {
    await db.none(
      dbUsers.update,
      [
        req.session.userId,
        userData.firstName,
        userData.lastName,
        userData.username,
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error updating user info',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
});

/* Get User Email */
app.get('/email', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  try {
    const email = await db.oneOrNone(dbUsers.selectEmail, req.session.userId);

    res.status(200).json({ email: email.email });

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting email',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
});

/* Update User Email */
app.put('/email', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  if (!Validation.isValidEmail(userData.email)) {
    res.status(400).send('Invalid email address');
  }

  try {
    const email = await db.oneOrNone(dbUsers.validate.email, userData.email);

    if (email.count !== '0') {
      res.status(400).send('Your new email address cannot be the same as your current email address');

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting username and email',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }

  try {
    await db.none(
      dbUsers.updateEmail,
      [
        req.session.userId,
        userData.email,
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error updating email',
      error: e
    });

    res.status(500).json({ message: 'Unfortunately we are experiencing technical difficulties right now' });

    return;
  }
});

/* Get Suggested Profiles */
app.get('/suggestions', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  try {
    const profile = await db.oneOrNone(dbUserProfiles.select, req.session.userId);

    if (profile === null) {
      res.status(400).send();

      return;
    }

    try {
      let query = null;

      switch (profile.sexuality_id) {
        case 1:
          query = dbUsers.suggestions.heterosexual;
          break;
        case 2:
          query = dbUsers.suggestions.homosexual;
          break;
        case 3:
          query = dbUsers.suggestions.bisexual;
          break;
        default:
          res.status(400).send()
          return;
      }

      let suggestions = await db.any(
        query,
        [
          req.session.userId,
          profile.gender_id
        ]
      );

      let tempSuggestions = [...suggestions];
      for (let suggestion of tempSuggestions) {
        let today = new Date();
        let birthdate = new Date(suggestion.birthdate);
        let age = today.getFullYear() - birthdate.getFullYear();
        let month = today.getMonth() - birthdate.getMonth();

        if (month < 0 || (month === 0 && today.getDate() < birthdate.getDate())) {
          age--;
        }

        suggestion.age = age;

        let suggestionInterests = await db.any(dbUserInterests.select, suggestion.id);
        suggestion.interests = suggestionInterests;
      }

      let userInterests = await db.any(dbUserInterests.select, req.session.userId);

      suggestions = suggestions.sort((a, b) => {
        return b.rating - a.rating;
      });

      suggestions = suggestions.sort((a, b) => {
        let sharedInterestCountA = 0;
        let sharedInterestCountB = 0;

        for (let userInterest of userInterests) {
          for (let interest of a.interests) {
            if (userInterest.interest_id === interest.interest_id) {
              sharedInterestCountA++;
              break;
            }
          }
        }

        for (let userInterest of userInterests) {
          for (let interest of b.interests) {
            if (userInterest.interest_id === interest.interest_id) {
              sharedInterestCountB++;
              break;
            }
          }
        }

        return sharedInterestCountB - sharedInterestCountA;
      });

      // Remove blocked users or users who have blocked you from results
      for (let suggestion in suggestions) {
        try {
          const blocked = await db.oneOrNone(
            dbBlocked.selectFromUsers,
            [
              suggestions[suggestion].id,
              req.session.userId
            ]
          );

          if (blocked !== null) {
            suggestions.splice(suggestions[suggestion], 1);
          }
        } catch (e) {
          logger.log({
            level: 'error',
            message: 'Error retrieving blocks',
            error: e
          });

          res.status(500).json({
            message: 'Unfortunately we are experiencing technical difficulties right now'
          });

          return;
        }
      }

      const cleanSuggestions = await suggestions.map((suggestion) => {
        const {
          id,
          username,
          first_name,
          last_name,
          gender,
          sexuality,
          age,
          rating,
          interests
        } = suggestion;

        return {
          userId: id,
          username,
          firstName: first_name,
          lastName: last_name,
          gender,
          sexuality,
          age,
          rating,
          interests
        }
      });

      for (let suggestion of cleanSuggestions) {
        const images = await db.any(dbImages.selectAll, suggestion.userId);

        let re = new RegExp(/^.*\/(.+\..+)$/)

        let imagePaths = [];

        if (images && images.length) {
          imagePaths = images.map((image) => ({ id: image.id, path: re.exec(image.image_path)[1] }));
        }

        suggestion.images = imagePaths;
      }

      res.status(200).json(cleanSuggestions);

      return;
    } catch (e) {
      logger.log({
        level: 'error',
        message: 'Error getting user suggestions',
        error: e
      });

      res.status(500).json({
        message: 'Unfortunately we are experiencing technical difficulties right now'
      });

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting user profile',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Browse Profiles */
app.post('/search-profiles', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  try {
    const profile = await db.oneOrNone(dbUserProfiles.select, req.session.userId);

    if (profile === null) {
      res.status(400).send();

      return;
    }

    try {
      let query = null;

      switch (profile.sexuality_id) {
        case 1:
          query = dbUsers.suggestions.heterosexual;
          break;
        case 2:
          query = dbUsers.suggestions.homosexual;
          break;
        case 3:
          query = dbUsers.suggestions.bisexual;
          break;
        default:
          res.status(400).send()
          return;
      }

      let suggestions = await db.any(
        query,
        [
          req.session.userId,
          profile.gender_id
        ]
      );

      let tempSuggestions = [...suggestions];
      for (let suggestion of tempSuggestions) {
        let today = new Date();
        let birthdate = new Date(suggestion.birthdate);
        let age = today.getFullYear() - birthdate.getFullYear();
        let month = today.getMonth() - birthdate.getMonth();

        if (month < 0 || (month === 0 && today.getDate() < birthdate.getDate())) {
          age--;
        }

        suggestion.age = age;

        if (age < userData.minAge || age > userData.maxAge) {
          suggestions.splice(suggestions.indexOf(suggestion), 1);
          continue;
        }

        let rating = suggestion.rating;
        if (rating < userData.minRating || rating > userData.maxRating) {

          suggestions.splice(suggestions.indexOf(suggestion), 1);
          continue;
        }

        let userInterests = await db.any(dbUserInterests.select, suggestion.id);
        suggestion.interests = userInterests;
        for (let interest of userData.interests) {
          let hasInterest = false;
          for (let userInterest of userInterests) {
            if (userInterest.interest_id === interest.id) {
              hasInterest = true;
              break;
            }
          }
          if (!hasInterest) {
            suggestions.splice(suggestions.indexOf(suggestion), 1);
            continue;
          }
        }
      };

      // Remove blocked users or users who have blocked you from results
      for (let suggestion in suggestions) {
        try {
          const blocked = await db.oneOrNone(
            dbBlocked.selectFromUsers,
            [
              suggestions[suggestion].id,
              req.session.userId
            ]
          );

          if (blocked !== null) {
            suggestions.splice(suggestions[suggestion], 1);
          }
        } catch (e) {
          logger.log({
            level: 'error',
            message: 'Error retrieving blocks',
            error: e
          });

          res.status(500).json({
            message: 'Unfortunately we are experiencing technical difficulties right now'
          });

          return;
        }
      }

      const cleanSuggestions = await suggestions.map((suggestion) => {
        const {
          id,
          username,
          first_name,
          last_name,
          gender,
          sexuality,
          age,
          rating,
          interests
        } = suggestion;

        return {
          userId: id,
          username,
          firstName: first_name,
          lastName: last_name,
          gender,
          sexuality,
          age,
          rating,
          interests
        }
      });

      for (let suggestion of cleanSuggestions) {
        const images = await db.any(dbImages.selectAll, suggestion.userId);

        let re = new RegExp(/^.*\/(.+\..+)$/)

        let imagePaths = [];

        if (images && images.length) {
          imagePaths = images.map((image) => ({ id: image.id, path: re.exec(image.image_path)[1] }));
        }

        suggestion.images = imagePaths;
      }

      res.status(200).json(cleanSuggestions);

      return;
    } catch (e) {
      logger.log({
        level: 'error',
        message: 'Error getting user profiles',
        error: e
      });

      res.status(500).json({
        message: 'Unfortunately we are experiencing technical difficulties right now'
      });

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting user profile',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* User Profile */
app.get('/profile', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userId = req.query.userId
    ? req.query.userId
    : req.session.userId;

  try {
    const profile = await db.oneOrNone(dbUserProfiles.select, userId);

    if (profile === null) {
      res.status(204).send();

      return;
    }

    res.status(200).json(profile);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting user profile',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Update Profile */
app.put('/profile', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  // TODO: Birthdate validation method
  // if (!(Validation.isValidBiography(userData.biography)
  //     && Validation.isValidBirthdate(userData.birthdate))) {
  //   res.status(400).send();

  //   return;
  // }

  try {
    const profile = await db.oneOrNone(dbUserProfiles.select, req.session.userId);

    let query = null;

    if (profile === null) {
      query = dbUserProfiles.create;
    } else {
      query = dbUserProfiles.update;
    }

    await db.none(
      query,
      [
        req.session.userId,
        userData.gender_id,
        userData.sexuality_id,
        userData.biography,
        userData.birthdate
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error updating user profile',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Like Profile */
app.post('/like', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  // Can't like yourself :(
  if (userData.targetId === req.session.userId) {
    res.status(400).send();

    return;
  }

  try {
    // TODO: check if users are blocked
    const blocked = await db.oneOrNone(
      dbBlocked.selectFromUsers,
      [
        req.session.userId,
        userData.targetId
      ]
    );

    if (blocked !== null) {
      res.status(403).send();

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error checking if users are blocked',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }

  try {
    const like = await db.oneOrNone(
      dbLikes.select,
      [
        req.session.userId,
        userData.targetId
      ]
    );

    // Can't like a user more than once
    if (like !== null) {
      res.status(400).send();

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error checking if user is already liked',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }

  try {
    await db.none(
      dbLikes.create,
      [
        req.session.userId,
        userData.targetId
      ]
    );

    try {
      const liked = await db.oneOrNone(
        dbLikes.select,
        [
          userData.targetId,
          req.session.userId
        ]
      );

      try {
        if (liked !== null) {
          const match = await db.oneOrNone(
            dbMatches.selectFromUsers,
            [
              req.session.userId,
              userData.targetId
            ]
          );

          // Match users if they like eachother and aren't matched
          if (match === null) {
            try {
              await db.none(
                dbMatches.create,
                [
                  req.session.userId,
                  userData.targetId
                ]
              );
            } catch (e) {
              logger.log({
                level: 'error',
                message: 'Error matching users',
                error: e
              });

              res.status(500).json({
                message: 'Unfortunately we are experiencing technical difficulties right now'
              });

              return;
            }
          }
        }

        res.status(200).send();

        return;
      } catch (e) {
        logger.log({
          level: 'error',
          message: 'Error checking if target is matched',
          error: e
        });

        res.status(500).json({
          message: 'Unfortunately we are experiencing technical difficulties right now'
        });

        return;
      }
    } catch (e) {
      logger.log({
        level: 'error',
        message: 'Error checking if target is liked',
        error: e
      });

      res.status(500).json({
        message: 'Unfortunately we are experiencing technical difficulties right now'
      });

      return;
    }
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error liking users',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Unlike Profile */
app.delete('/like', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  try {
    const userData = req.body;

    await db.none(
      dbLikes.remove,
      [
        req.session.userId,
        userData.targetId
      ]
    );

    const match = await db.oneOrNone(
      dbMatches.selectFromUsers,
      [
        userData.targetId,
        req.session.userId
      ]
    );

    // Unmatch users
    if (match !== null) {
      await db.none(dbMatches.remove, match.id);
    }

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error unliking users',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Likes */
app.get('/likes', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  try {
    const like = await db.oneOrNone(
      dbLikes.select,
      [
        req.session.userId,
        req.query.userId
      ]
    );

    if (like !== null) {
      res.status(200).send(like);

      return;
    }

    res.status(400).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting likes',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Matches */
app.get('/matches', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  try {
    let matches = await db.any(dbMatches.selectFromUser, req.session.userId);

    matches = matches.map((match) => {
      return req.session.userId === match.user_id_1
        ? { matchId: match.id, userId: match.user_id_2 }
        : { matchId: match.id, userId: match.user_id_1 };
    })

    res.status(200).json(matches);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting matches',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Match */
app.get('/match', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  let userId = req.query.userId;

  try {
    let match = await db.oneOrNone(
      dbMatches.selectFromUsers,
      [
        req.session.userId,
        userId
      ]
    );

    if (match !== null) {
      res.status(200).json(match);

      return;
    }

    res.status(400).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting match',
      error: e
    });

    res.status(500).send();

    return;
  }
});

/* Send Message */
app.post('/message', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  try {
    const match = await db.oneOrNone(dbMatches.select, userData.matchId);

    if (match === null) {
      res.status(400).send();

      return;
    }

    if (match.user_id_1 !== req.session.userId && match.user_id_2 !== req.session.userId) {
      res.status(400).send();

      return;
    }

  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error validating match',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }

  try {
    await db.none(
      dbChatMessages.create,
      [
        req.session.userId,
        userData.matchId,
        userData.chatMessage
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error sending message',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Messages */
app.get('/messages', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const matchId = req.query.matchId;

  try {
    const match = await db.oneOrNone(dbMatches.select, matchId);

    if (match === null) {
      res.status(400).send();

      return;
    }

    if (match.user_id_1 !== req.session.userId && match.user_id_2 !== req.session.userId) {
      res.status(400).send();

      return;
    }

  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error validating match',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }

  try {
    const messages = await db.any(dbChatMessages.select, matchId);

    res.status(200).json(messages);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting messages',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Block */
app.get('/block', async (req, res) => {
  if (!res.session.userId) {
    res.status(403).send();

    return;
  }

  const userId = req.query.userId;

  try {
    const blocked = await db.oneOrNone(
      dbBlocked.selectFromUsers,
      [
        req.session.userId,
        userId
      ]
    );

    res.status(200).json(blocked);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error blocked user',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Block User */
app.post('/block', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  try {
    const match = await db.oneOrNone(
      dbMatches.selectFromUsers,
      [
        req.session.userId,
        userData.targetId
      ]
    );

    // Unmatch users
    if (match !== null) {
      try {
        await db.none(dbMatches.remove, match.id);
      } catch (e) {
        logger.log({
          level: 'error',
          message: 'Error unmatching users',
          error: e
        });

        res.status(500).json({
          message: 'Unfortunately we are experiencing technical difficulties right now'
        });

        return;
      }
    }

    try {
      const liker = await db.oneOrNone(
        dbLikes.select,
        [
          req.session.userId,
          userData.targetId
        ]
      );

      const liked = await db.oneOrNone(
        dbLikes.select,
        [
          userData.targetId,
          req.session.userId
        ]
      );

      // Unlike users
      if (liker !== null) {
        await db.none(
          dbLikes.remove,
          [
            req.session.userId,
            userData.targetId
          ]
        );
      }

      if (liked !== null) {
        await db.none(
          dbLikes.remove,
          [
            userData.targetId,
            req.session.userId
          ]
        );
      }
    } catch (e) {
      logger.log({
        level: 'error',
        message: 'Error unliking users',
        error: e
      });

      res.status(500).json({
        message: 'Unfortunately we are experiencing technical difficulties right now'
      });

      return;
    }

    await db.none(
      dbBlocked.create,
      [
        req.session.userId,
        userData.targetId
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error blocking user',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Unblock User */
app.post('/unblock', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  try {
    await db.none(
      dbBlocked.remove,
      [
        req.session.userId,
        userData.targetId
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error unblocking user',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Genders */
app.get('/genders', async (req, res) => {
  try {
    const genders = await db.any(dbGenders.selectAll);

    res.status(200).send(genders);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting genders',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Sexualities */
app.get('/sexualities', async (req, res) => {
  try {
    const sexualities = await db.any(dbSexualities.selectAll);

    res.status(200).send(sexualities);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting sexualities',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get Interests */
app.get('/interests', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  try {
    const interests = await db.any(dbInterests.select);

    res.status(200).json(interests);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting interests',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get User Interests */
app.get('/user-interests', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userId = req.query.userId
    ? req.query.userId
    : req.session.userId;

  try {
    const userInterests = await db.any(dbUserInterests.select, userId);

    res.status(200).json(userInterests);

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting user interests',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Add User Interest */
app.post('/user-interest', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  try {
    await db.none(
      dbUserInterests.create,
      [
        req.session.userId,
        userData.interest_id
      ]
    );

    res.status(201).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error adding user interest',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Remove User Interests */
app.delete('/user-interest', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userData = req.body;

  try {
    await db.none(
      dbUserInterests.remove,
      [
        req.session.userId,
        userData.interest_id
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error removing user interest',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Get User Images */
app.get('/user-images', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const userId = req.query.userId
    ? req.query.userId
    : req.session.userId;

  try {
    const images = await db.any(dbImages.selectAll, userId);

    let re = new RegExp(/^.*\/(.+\..+)$/)

    const imagePaths = images.map((image) => ({ id: image.id, path: re.exec(image.image_path)[1] }));

    res.status(200).json({ images: imagePaths });

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting user images',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

/* Add User Images */
app.post('/user-images', upload.array('images', 5), async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  const images = req.files;

  if (images.length > 5) {
    for (let image of images) {
      fs.unlink(image.path, (e) => {
        if (e) {
          logger.log({
            level: 'error',
            message: 'Error deleting file',
            error: e
          });

          res.status(500).json({
            message: 'Unfortunately we are experiencing technical difficulties right now'
          });

          return;
        }
      });
    }

    res.status(400).send('Cannot upload more than five images');

    return;
  }

  try {
    const imageCount = await db.oneOrNone(dbImages.selectCount, req.session.userId);
    const count = parseInt(imageCount.count);

    if (imageCount !== null && (count >= 5 || count + images.length > 5)) {
      res.status(400).send('Cannot have more that five images');

      for (let image of images) {
        fs.unlink(image.path, (e) => {
          if (e) {
            logger.log({
              level: 'error',
              message: 'Error deleting file',
              error: e
            });

            res.status(500).json({
              message: 'Unfortunately we are experiencing technical difficulties right now'
            });

            return;
          }
        });
      }

      return;
    }
  } catch (e) {
    console.log('Error getting image count for user: ' + e.message || e);

    for (let image of images) {
      fs.unlink(image.path, (e) => {
        if (e) {
          logger.log({
            level: 'error',
            message: 'Error deleting file',
            error: e
          });

          res.status(500).json({
            message: 'Unfortunately we are experiencing technical difficulties right now'
          });

          return;
        }
      });
    }

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }

  for (let image of images) {
    try {
      await db.none(
        dbImages.create,
        [
          req.session.userId,
          image.path,
          image.mimetype
        ]
      );
    } catch (e) {
      logger.log({
        level: 'error',
        message: 'Error adding user images',
        error: e
      });

      fs.unlink(image.path, (e) => {
        logger.log({
          level: 'error',
          message: 'Error deleting file',
          error: e
        });
      });

      res.status(500).json({
        message: 'Unfortunately we are experiencing technical difficulties right now'
      });

      return;
    }
  }

  res.status(201).send();

  return;
});

/* Remove User Image */
app.delete('/user-image', async (req, res) => {
  if (!req.session.userId) {
    res.status(403).send();

    return;
  }

  try {
    const image = await db.oneOrNone(
      dbImages.select,
      [
        req.session.userId,
        req.query.imageId
      ]
    );

    if (image === null) {
      res.status(400).send();

      return;
    }

    fs.unlink(image.image_path, (e) => {
      if (e) {
        logger.log({
          level: 'error',
          message: 'Error deleting file',
          error: e
        });

        res.status(500).json({
          message: 'Unfortunately we are experiencing technical difficulties right now'
        });

        return;
      }
    });
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error getting user image',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }

  try {
    await db.none(
      dbImages.remove,
      [
        req.session.userId,
        req.query.imageId
      ]
    );

    res.status(200).send();

    return;
  } catch (e) {
    logger.log({
      level: 'error',
      message: 'Error deleting user image',
      error: e
    });

    res.status(500).json({
      message: 'Unfortunately we are experiencing technical difficulties right now'
    });

    return;
  }
});

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`);
});