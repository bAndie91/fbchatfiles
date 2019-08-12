
const fs = require('fs');
const fblogin = require('facebook-chat-api');

var apiStateFile = process.env.FBCHATFILES_APISTATE || "./apistate.json";
var apiState = JSON.parse(fs.readFileSync(apiStateFile, 'utf8'));
if(!apiState.map) apiState = undefined;

fblogin({appState: apiState, email: process.env.FACEBOOK_EMAIL, password: process.env.FACEBOOK_PASSWORD}, (err, api) => {
    if(err)
    {
    	console.error(err);
    	process.exit(13);
    	return;
    }
    fs.writeFileSync(apiStateFile, JSON.stringify(api.getAppState()));
    process.exit(0);
});
