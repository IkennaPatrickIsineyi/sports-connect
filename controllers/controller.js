//dm.controller.js 
//import model
const db = require('../models/model.js');
//import bcrypt for password encryption and comparison 
const bcrypt = require('bcrypt');
//For generating OTP code
const otpGen = require('otp-generator');
//For sending emails
const mailer = require('nodemailer');
//For sending API requests
const got = require('got');
//For creating formdata for API request
const FormData = require('form-data');


//create database tables and triggers
//This should be done everytime the server boots
exports.setupDatabase = (callback) => {
	//List of functions for creating the databases and triggers
	//The functions will be called recursively
	const tables = [db.createUsertb, db.createInteresttb, db.createEmailHashtb];

	let count = 0;

	const builder = (nextCount) => {
		tables[count](function (err) {
			count++;
			if (err) {
				console.log("error executing query ", count, err);
			}
			else {
				console.log("Setup query ", count, " executed", this);
			}
			if (count < tables.length) return builder(nextCount);
			else return callback();
		});
	};

	builder(count);
};


//check if user is logged in: user required to log in first else request fails
exports.isLoggedIn = (req, res, next) => {
	if (req.session.user) return next(); //User is logged in, hence proceed to next middleware
	else return res.send({ error: 'not-logged-in' });
};

//check if user is not logged in: user required to log out first else request fails
exports.isNotLoggedIn = (req, res, next) => {
	if (!req.session.user) return next(); //User is not logged in, hence proceed to next middleware
	else return res.send({ error: 'already-logged-in' });
};

//validate login credentials. and log in user
exports.login = (req, res) => {
	const body = req.body;
	const userId = body?.userId;
	const password = body.password;

	//Fetch user's password hash for comparison
	db.getPasswordHash(userId, function (err, result) {
		if (err) {
			//error occurred
			console.log(err);
			return res.send({ error: 'failed', errMsg: 'retrieval' });
		}
		else if (result.length) {
			//email exists in database. 
			//Hash password and compare it with the hash from the database
			bcrypt.compare(password, result[0].password,
				function (err, match) {
					if (match) {
						//regenerate session id and log user in
						req.session.regenerate(function (err) {
							if (err) return res.send({ error: 'generic', errMsg: 'Try again later' });

							//save changes
							req.session.save(function (err) {
								if (err) return res.send({ error: 'generic', errMsg: 'Try again' });
								// log user in by setting user id to email 
								req.session.user = userId;
								//send user to index page
								return res.send({
									useData: {
										username: result[0].username,
										emailVerified: result[0].email_verified
									}, result: 'success'
								});
							});//req.session.save
						});//req.session.regenerate
					}
					else {
						//reject login request
						return res.send({ error: 'generic', errMsg: 'Invalid login data' });
					}
				});//bcrypt
		}//else if
		else {
			//email does not exist
			return res.send({ error: 'generic', errMsg: 'Invalid login data' });
		}
	});//db.getPasswordHash
};//exports.validateLoginCredential


//register new user
const registerUser = (req, res, data) => {
	//generate hash of password using saltrounds of 10 
	bcrypt.hash(data.password, 10, function (err, passwordHash) {
		if (err) {
			console.log(err);
			//Something went wrong: send the user to registration page
			res.send({ error: 'register', errMsg: 'Something went wrong. Please register later' });
			return res.send({ error: 'failed', errMsg: 'hashErr' });
		}
		//register user
		//username, email, password, phone, interestList, 
		db.register(data.username, data.email,
			passwordHash, data.phone, data.interests,
			function (err) {
				if (err) {
					console.log(err);
					//Something went wrong: send the user to registration page
					res.send({ error: 'register', errMsg: 'Something went wrong. Please register later' });
				} else if (this.changes) {
					//send response to user. Send the user to index page.
					//We could have just logged the user in, but that will increase request processing time.
					//When the user is routed to the index page, they will be showed the login page
					res.send({ result: 'success' });
				}
				else {
					//Something went wrong: send the user to registration page
					res.send({ error: 'register', errMsg: 'Something went wrong. Please register later' });
				}
			});
	});
};

//log out user
exports.logout = (req, res) => {
	//Reset session Id by generating a new one.
	// This will automatically delete the user's session, logging them out
	req.session.regenerate(function (err) {
		if (err) {
			console.log('regen error');
			return res.send({ error: 'saving-error', result: 'logged-out' });
		}
		else {
			//Create new session Id
			req.session.save(function (err) {
				if (err) {
					console.log("saving error");
					res.send({ error: 'saving-error', result: 'logged-out' });
				}
				else {
					//console.log('saved');
					res.send({ result: 'logged-out' });
				}
			})
		}
	})
};

//send email
const sendEmail = (payload, req, res, callback) => {
	const setting = {
		service: 'gmail',
		auth: {
			user: process.env.EMAIL,
			pass: process.env.EMAIL_PASSWORD
		}
	};

	console.log('email payload', payload);

	let transporter = mailer.createTransport(setting);
	transporter.sendMail(payload, (err, result) => {
		if (err) {
			console.log(err);
			return res.send({ error: 'failed', errMsg: 'email-error' });
		}
		callback(req, res, result);
	})
}

//sends sms to a phone number using smartsmssolution.com API
//You can use any other sms service provider's API
const sendSMS = (req, res, body, callback) => {
	const url = 'https://app.smartsmssolutions.com/io/api/client/v1/sms/';
	const method = 'POST';
	const token = process.env.SMS_API_KEY;

	const payload = {
		token: token,
		sender: body.sender,
		to: body.to,
		message: body.message,
		type: 0,
		routing: 3,
	};

	const formData = new FormData();

	Object.entries(payload).map(item =>
		formData.append(item[0], item[1]));


	const options = {
		method: 'POST',
		body: formData,
		redirect: 'follow',
		responseType: 'json'
	};

	/* const payloadArr = Object.entries(payload);
	console.log(payloadArr); */

	got.post(url, options).then((response) => {
		console.log(response.body);
		if (response.body.successful) {
			console.log("SMS sent successfully");
			return callback(req, res,);
		}
		else if (response.body.invalid) {
			console.log('Invalid phone number');
			//At the front end, user should be navigated to registration page with state set previous registration data
			res.send({ error: 'invalid', errMsg: 'Invalid phone number. Enter a valid phone number ' });
		}
		else {
			console.log('SMS was not sent');
			res.send({ error: 'generic', errMsg: 'Failed:OTP was not sent. Try again ' });
		}
	},
		(error) => {
			console.log('Network failure: Check your Internet connection ');
			res.send({ error: 'generic', errMsg: 'Failed:OTP was not sent. Try again ' });
		}
	);
}

//generate and send OTP to user
exports.generateOTP = () => {
	return otpGen.generate(5, {
		digits: true,
		lowerCaseAlphabets: false,
		upperCaseAlphabets: false, specialChars: false
	});
};

//send OTP to user
const sendOTP = (req, res, email, phone, type) => {


	//req.session.email = result[0]?.email;
	//	req.session.phone = result[0]?.phone;

	const otp = this.generateOTP();
	//save otp for sms verification in session object.
	//It was not saved to database because the user if likely
	//not to go through with the registration process.
	req.session.smsOtp = otp;

	//create hash of otp to be used in email verification link
	//Generating a random string can also do the job
	bcrypt.hash(otp, 3, function (err, OTPHash) {
		if (err) {
			console.log(err);
			OTPHash = new Date().getMilliseconds().toString();
		}
		else {
			if (type === 'registration') {
				//save email verificatio hash to be sent to the user's email 
				db.saveEmailVerificationHash(OTPHash, email, function (err) {
					if (err) {
						console.log(err);
						return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
					}
					else if (this.changes) {
						//send email
						const Emailpayload = {
							from: process.env.EMAIL,
							to: email,
							subject: 'Verify your email',
							//	text: `To verify your email follow this link https//:${req.hostname}/api/?code=${OTPHash}`
							text: `Your OTP for registration on BrilCon is ${otp}`
						};

						const smsPayload = {
							sender: 'OTP NG',
							to: phone,
							message: `Your OTP for registration on BrilCon is ${otp}`
						};

						//For registration only: verifies both email and phone number
						//Could not find any reliable SMS provider for sending OTP.
						//So email was used. 
						/* phone && sendSMS(req, res, smsPayload,
							function (req, res) {
								sendEmail(Emailpayload, req, res,
									(req, res, reply) => {
										console.log('email sent', reply.accepted);
									});
								res.send({ result: 'sent' })
							}
						) */

						//Send OTP as email
						sendEmail(Emailpayload, req, res,
							(req, res, reply) => {
								console.log('email sent', reply.accepted);
								res.send({ result: 'sent' });
							}
						);
					}
					else {
						console.log('failed');
						return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
					}
				});
			}
			else {
				//send email for password rest
				const Emailpayload = {
					from: process.env.EMAIL,
					to: email,
					subject: 'Confirm Password Reset',
					text: `The OTP required to reset your BrilCon Password is ${otp}`
				};

				//For password reset via email only
				!phone && sendEmail(Emailpayload, req, res,
					(req, res, reply) => {
						console.log('email sent', reply.accepted);
						res.send({ result: 'sent' });
					}
				);
			}

		}
	})
};

//sends otp. OTP is required for registration and resetting password
exports.otpRequest = (req, res) => {
	if (req.query?.type === 'registration') {
		sendOTP(req, res, req.query?.email, req.query?.phone, type = 'registration');
	}
	else {
		req.session.email = req.query?.email;
		sendOTP(req, res, req.query?.email, null, null);
	}
}

//Check that otp matches the otp that was assigned to this user.
exports.verifyPhone = (req, res) => {
	if (req.session?.smsOtp === req.body?.otp) {
		console.log(req.body?.data);
		registerUser(req, res, req.body?.data);
	}
	else {
		res.send({ error: 'invalid', errMsg: 'Invalid OTP.' })
	}
};

//Check that otp matches the emailotp that was assigned to this user.
exports.verifyEmail = (req, res) => {
	const hash = req.param.id
	console.log(hash);
	db.updateEmailVerified(hash, function (err) {
		if (err) {
			console.log(err);
			return res.send('something went wrong')
		}
		db.verifyEmail(hash, function (err) {
			if (err) {
				console.log(err);
				res.send('something went wrong')
			}
			else if (this.changes) {
				console.log('email verified');
				res.redirect('/');
			} else {
				res.send('Invalid');
			}
		})
	})

}

//Check that otp matches the otp that was assigned to this user.
exports.verifyOtp = (req, res) => {
	console.log('req.session?.smsOtp', req.session?.smsOtp);
	console.log('req.body?.otp', req.body?.otp);
	if (req.session?.smsOtp === req.body?.otp) {
		console.log(req.body?.data);
		req.session.otpVerified = true;
		res.send({ result: 'valid' })
	}
	else {
		res.send({ error: 'invalid', errMsg: 'Invalid OTP.' })
	}
}

//change password. This is for forgot password, which requires OTP
exports.changePassword = (req, res) => {
	if (!req.session.otpVerified) {
		return res.send({ error: 'generic', errMsg: 'Invalid request. OTP not validated' });
	}
	else bcrypt.hash(req.body.password, 10, function (err, passwordHash) {
		if (err) res.send({ error: 'failed', errMsg: 'hashErr' });
		db.changePassword(passwordHash, req.session.email,
			function (err) {
				if (err) return res.send({
					error: 'generic',
					errMsg: 'Something went wrong. Try again later'
				});
				if (this.changes) {
					req.session.otpVerified = null; //delete    
					req.session.email = null; //delete
					res.send({ result: 'success' });
				}
				else {
					req.session.otpVerified = null; //delete  
					req.session.email = null; //delete
					res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
				}
			}
		);
	});
};

//change password of already logged in user. Requires no OTP
exports.updatePassword = (req, res) => {
	//Hash the password
	bcrypt.hash(req.body.password, 10, function (err, passwordHash) {
		if (err) res.send({
			error: 'generic',
			errMsg: 'Something went wrong. Try again later'
		});
		//replace the existing password hash with the new password hash
		db.updatePassword(passwordHash, req.session.user,
			function (err) {
				if (err) return res.send({
					error: 'generic',
					errMsg: 'Something went wrong. Try again later'
				});
				if (this.changes) {
					res.send({ result: 'success' });
				}
				else {
					res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
				}
			}
		);
	});
};

//get profile data for editing
exports.getUsername = (req, res) => {
	db.getUsername(req.session.user, function (err, result) {
		if (err) {
			console.log(err);
			return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
		}
		res.send({ result: result[0] });
	});
};

//get profile email of this user
exports.getEmail = (req, res) => {
	db.getEmail(req.session.user, function (err, result) {
		if (err) {
			console.log(err);
			return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
		}
		res.send({ result: result[0] });
	});
};

//change the email of this user
exports.updateEmail = (req, res) => {
	db.updateEmail(req.body.email, req.session.user, function (err) {
		if (err) {
			console.log(err);
			return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
		}
		return res.send({ result: 'success' });
	});
};

//change the username of this user
exports.updateUsername = (req, res) => {
	db.updateUsername(req.body.username, req.session.user, function (err) {
		if (err) {
			console.log(err);
			return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
		}
		return res.send({ result: 'success' });
	});
};

//get profile data (profile pic, personal details, interests) for display
exports.getProfileData = (req, res) => {
	const profile = {}
	//fetch user's personal data
	db.getProfileData(req.session.user, function (err, result) {
		if (err) {
			console.log(err);
			return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
		}
		else {
			profile.profileData = result[0];//save personal data
			//fetch user's interests
			db.getInterests(req.session.user, function (err, result) {
				if (err) {
					console.log(err);
					return res.send({ error: 'generic', errMsg: 'Something went wrong. Try again later' });
				}
				else {
					profile.interests = result;
					res.send({ result: profile });
				}
			})
		}
	});
};

//Get the item to be displayed on front page
exports.getFrontPageItems = (req, res) => {
	console.log('getFrontPageItems');

	//find all users who have the same interests as this user
	db.findLikeMinds(req.session.user, function (err, result) {
		console.log(result);
		if (err) {
			console.log(err);
			return res.send({
				error: 'generic',
				errMsg: 'Something went wrong. We are working on it'
			});
		}
		else {
			const data = {}

			//group interests by username 
			result?.map((item) =>
				data[item?.username] = {
					profilePicture: item?.profile_picture,
					interests: [...data[item?.username]?.interests ?? [], item?.interest]
				}
			)
			console.log(data);
			const frontPage = { ...data };
			//get user data
			db.getUserIdentity(req.session.user, function (err, result) {
				if (err) {
					console.log(err);
					return res.send({
						error: 'generic',
						errMsg: 'Something went wrong. We are working on it'
					});
				}
				else {
					console.log('success')
					res.send({ userData: result[0], result: { frontPage: frontPage } });
				}
			})

		}
	});
};


//Check if a certain column in any record has the given value
exports.validate = (req, res) => {
	db.validate(req.query.column, req.query.value, function (err, result) {
		if (err) {
			console.log(err);
			return res.send({
				error: 'not-available',
				errMsg: req.query.column + ' already exists. Choose another value'
			});
		}
		else if (result.length) {
			return res.send({
				error: 'not-available',
				errMsg: req.query.column + ' already exists. Choose another value'
			});
		}
		else {
			return res.send({ result: 'available' });
		}
	});
}

//Get all interests of a user
exports.getUserDetails = (req, res) => {
	//find personal details and interests of this particular user
	db.getUserDetails(req.query.username, function (err, result) {
		if (err) {
			console.log(err);
			return res.send({ error: 'failed', errMsg: 'db-error' });
		}
		else {
			res.send({ result: result });
		}
	});
};
