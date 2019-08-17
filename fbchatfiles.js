
const fs = require('fs');
const fblogin = require('facebook-chat-api');
const AsyncLock = require('async-lock');
const Url = require('url');
var lock = new AsyncLock();
var userAgent;

function loadUserAgentString(file)
{
	if(fs.existsSync(file))
		userAgent = fs.readFileSync(file, 'utf8');
}

function loadJSON(file)
{
	if(fs.existsSync(file))
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	else
		return {};
}

var apiStateFile = process.env.FBCHATFILES_APISTATE || "./apistate.json";
var stateFile = process.env.FBCHATFILES_STATE || "./state.json";
var apiState = loadJSON(apiStateFile);
if(!apiState.map) apiState = undefined;
var Globals = {
	state: loadJSON(stateFile),
};

loadUserAgentString(process.env.HOME + "/.local/share/fbchatfiles/user-agent.txt");

function saveFile(file, content)
{
	lock.acquire('save', () => {
		var tmpfile = file + '~';
		fs.writeFileSync(tmpfile, content);
		fs.renameSync(tmpfile, file);
	});
}


var Interval = function(min, max) {
	this.min = min;
	this.max = max;
	this.includes = function(ts) {
		if(this.min != null && this.max != null && this.min <= ts && this.max >= ts) return true;
		return false;
	};
};

var Intervals = function(list) {
	this.list = [];
	if(list)
	{
		list.forEach((obj) => {
			this.list.push(new Interval(obj.min, obj.max));
		});
	}
	this.getLast = function() {
		var last = this.list.sort((a, b) => {return b.min - a.min;})[0];
		if(!last) return {min: undefined, max: undefined};
		return last;
	};
	this.include = function(ts) {
		for(var idx = 0; idx < this.list.length; idx++)
		{
			var interval = this.list[idx];
			if(interval.includes(ts)) return true;
		}
		return false;
	};
	this.add = function(interval) {
		this.list.push(interval);
		this.normalize();
	};
	this.normalize = function() {
		var run = true;
		while(run)
		{
			for(var idx = 0; idx < this.list.length; idx++)
			{
				var interval = this.list[idx];
				var remove = [];
				
				for(var inIdx = 0; inIdx < this.list.length; inIdx++)
				{
					if(inIdx == idx) continue;
					
					var inInterval = this.list[inIdx];
					
					if(interval.includes(inInterval.min) && interval.includes(inInterval.max))
					{
						remove.push(inIdx);
					}
					else if(interval.includes(inInterval.min) && interval.max < inInterval.max)
					{
						interval.max = inInterval.max;
						remove.push(inIdx);
					}
					else if(interval.includes(inInterval.max) && interval.min > inInterval.min)
					{
						interval.min = inInterval.min;
						remove.push(inIdx);
					}
					else if(interval.max == inInterval.min*1 - 1)
					{
						interval.max = inInterval.max;
						remove.push(inIdx);
					}
					else if(interval.min == inInterval.max*1 + 1)
					{
						interval.min = inInterval.min;
						remove.push(inIdx);
					}
				}
				
				if(remove.length)
				{
					var n = 0;
					this.list = this.list.filter((x)=>{ return !remove.includes(n++); });
					break;
				}
				if(idx == this.list.length - 1)
				{
					run = false;
				}
			}
		}
	};
	this.remove = function(ts) {
		for(var idx = 0; idx < this.list.length; idx++)
		{
			var interval = this.list[idx];
			if(interval.includes(ts))
			{
				var new_max = interval.max;
				interval.max = ts*1 - 1;
				this.list.push(new Interval(ts*1 + 1, new_max));
				break;
			}
		}
	};
};



function processThreadList(limit, mostRecentTimestamp)
{
	Globals.api.getThreadList(limit, mostRecentTimestamp, ['INBOX'], (err, threads) => {
		if(err) return console.error(err);
		
		processThreads(threads, 0, (lastTimestamp) => {
			if(lastTimestamp)
			{
				processThreadList(10, lastTimestamp);
			}
		});
	});
}

function processThreads(threads, threadIndex, callbackFunction)
{
	/* we reached the end of threads in this period */
	if(threads.length <= threadIndex)
	{
		/* there was at least 1 thread processed */
		if(threadIndex > 0)
		{
			/* pass control back to processThreadList() with the earlies timestamp to continue */
			callbackFunction(threads[threadIndex-1].timestamp * 1);
		}
		return;
	}
	
	var thread = threads[threadIndex];
	var conversationName = thread.name;
	
	if(!conversationName)
	{
		conversationName = thread.participants
			.filter((user)=>{return user.userID!=Globals.fbuid})
			.sort((a, b)=>{return a.userID - b.userID})
			.map((user)=>{return user.name || "unknown user"})
			.join(", ");
	}
	
	conversationName = conversationName.replace(/\n/g, " ");
	thread.conversationName = conversationName;
	
	if(!Globals.state.threads[thread.threadID]) Globals.state.threads[thread.threadID] = {};
	if(!Globals.state.threads[thread.threadID].done) Globals.state.threads[thread.threadID].done = new Intervals();
	if(!Globals.state.threads[thread.threadID].file) Globals.state.threads[thread.threadID].file = {};
	Globals.state.threads[thread.threadID].conversationName = conversationName;
	Globals.state.threads[thread.threadID].timestamp = thread.timestamp;
	
	processThreadHistory(thread, 2, undefined, () => {
		processThreads(threads, threadIndex+1, callbackFunction);
	});
}

function processThreadHistory(thread, amount, mostRecentTimestamp, finishCallback)
{
	//console.log("mostRecentTimestamp: ("+(typeof mostRecentTimestamp)+")"+mostRecentTimestamp);
	
	Globals.api.getThreadHistory(thread.threadID, amount, mostRecentTimestamp, (err, messages) => {
		if(err) return console.error(err);
		
		console.log("[" + thread.conversationName + "] Processing " + messages.length + " messages (out of " + amount + ") preceding @" + (mostRecentTimestamp||"now"));
		
		var tsmin;
		var tsmax;
		var found = 0;
		
		for(var messageIdx = 0; messageIdx < messages.length; messageIdx++)
		{
			var message = messages[messageIdx];
			
			if(!tsmin || tsmin > message.timestamp) tsmin = message.timestamp;
			if(!tsmax || tsmax < message.timestamp) tsmax = message.timestamp;
			
			if(Globals.state.threads[thread.threadID].done.include(message.timestamp)) continue;
			
			if(message.type == 'message')
			{
				message.attachments.forEach((attachment) => {
					if(attachment.type.match(/^(file|animated_image|video|audio|photo|sticker)$/))
					{
						var name;
						if(attachment.type.match(/^(file|animated_image|video|audio|photo)$/))
						{
							name = attachment.filename.replace(/\n/g, " ");
						}
						if(attachment.type == 'sticker')
						{
							name = attachment.caption + "-" + attachment.ID;
						}
						Globals.state.threads[thread.threadID].file[attachment.ID] = {
							name: name,
							time: message.timestamp,
							sender: message.senderID,
						};
						found++;
						if(attachment.type == 'file')
						{
							Globals.state.threads[thread.threadID].file[attachment.ID].mime = attachment.contentType;
						}
						if(attachment.type.match(/^(file|animated_image|video|audio|sticker)$/))
						{
							/* TODO what if url empty */
							Globals.state.threads[thread.threadID].file[attachment.ID].url = attachment.url;
						}
						if(attachment.type == 'photo')
						{
							Globals.api.resolvePhotoUrl(attachment.ID, (err, photo_url) => {
								if(!err)
								{
									Globals.state.threads[thread.threadID].file[attachment.ID].url = photo_url;
									saveFile(stateFile, JSON.stringify(Globals.state));
								}
								/* TODO this else branch */
							});
						}
					}
					else if(attachment.type == 'share')
					{
						var url = attachment.playable ? attachment.playableUrl : attachment.url;
						if(url != null)
						{
							var pars = Url.parse(url);
							if(pars.host == 'l.facebook.com' && pars.pathname == '/l.php')
							{
								var u = pars.query.split(/&/).filter((x)=>{return x.match(/^u=/)});
								if(u)
								{
									u = u[0].replace(/^u=/, '');
									url = decodeURIComponent(u);
								}
							}
						}
						Globals.state.threads[thread.threadID].file[attachment.ID] = {
							name: attachment.playable ? '' : attachment.title,
							time: message.timestamp,
							islink: !attachment.playable,
							url: url,
							sender: message.senderID,
						};
						found++;
					}
				});
			}
		}
		
		Globals.state.threads[thread.threadID].done.add(new Interval(tsmin, tsmax));
		saveFile(stateFile, JSON.stringify(Globals.state));
		
		amount = 10;
		mostRecentTimestamp = Globals.state.threads[thread.threadID].done.getLast().min;
		
		console.log("[" + thread.conversationName + "] Found " + found + " files");
		
		if(messages.length > 1)
		{
			processThreadHistory(thread, amount, mostRecentTimestamp, finishCallback);
		}
		else
		{
			finishCallback();
		}
	});
}



if(!Globals.state.threads)
{
	Globals.state.threads = {};
}
for(k in Globals.state.threads)
{
	Globals.state.threads[k].done = new Intervals(Globals.state.threads[k].done.list);
	
	/* remove time points which have failed download */
	if(Globals.state.threads[k].file)
	{
		for(fileID in Globals.state.threads[k].file)
		{
			if(Globals.state.threads[k].file[fileID].failed)
			{
				Globals.state.threads[k].done.remove(Globals.state.threads[k].file[fileID].time);
			}
		}
	}
}


fblogin({appState: apiState, email: process.env.FACEBOOK_EMAIL, password: process.env.FACEBOOK_PASSWORD},
{userAgent: userAgent}, (err, api) => {
    if(err)
    {
    	console.error(err);
    	process.exit(13);
    	return;
    }
    
    fs.writeFileSync(apiStateFile, JSON.stringify(api.getAppState()));
	
	Globals.api = api;
	Globals.fbuid = api.getCurrentUserID();
	
	processThreadList(10, null);
});

