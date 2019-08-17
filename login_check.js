
const fs = require('fs');
const fblogin = require('facebook-chat-api');

var apiStateFile = process.env.FBCHATFILES_APISTATE || "./apistate.json";
var apiState = JSON.parse(fs.readFileSync(apiStateFile, 'utf8'));
if(!apiState.map) apiState = undefined;

function loadUserAgentString(file)
{
	if(fs.existsSync(file))
		userAgent = fs.readFileSync(file, 'utf8');
}

loadUserAgentString(process.env.HOME + "/.local/share/fbchatfiles/user-agent.txt");


fblogin({appState: apiState, email: process.env.FACEBOOK_EMAIL, password: process.env.FACEBOOK_PASSWORD},
{userAgent: userAgent}, (err, api) => {
    if(err)
    {
    	console.error(err);
    	process.exit(13);
    	return;
    }
    fs.writeFileSync(apiStateFile, JSON.stringify(api.getAppState()));
    process.exit(0);
});
