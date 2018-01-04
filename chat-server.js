// Require the packages we will use:
var http = require("http"),
  socketio = require("socket.io"),
  fs = require("fs");

// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
// This callback runs when a new connection is made to our HTTP server.

  switch (req.url) {
    case "/client.css" :
      fs.readFile("client.css", function(err, data){
      // This callback runs when the client.css file has been read from the filesystem.
      if(err) return resp.writeHead(500);
      resp.writeHead(200, {'Content-Type': 'text/css'});
      resp.end(data);
    });
    break;
    default :
      fs.readFile("client.html", function(err, data){
      // This callback runs when the client.html file has been read from the filesystem.
      if(err) return resp.writeHead(500);
      resp.writeHead(200);
      resp.end(data);
    });
  }
});
app.listen(3456);

//our classes
function User (username, id) {
  this.username = username;
  this.id = id;
}
function Chatroom (name, id, creator, password) {
  this.name = name;
  this.id = id;
  this.creator = creator;
  this.password = password;
  this.members = [];
  this.banned = [];
  this.messages = [];
}
function Message(id, room_id, sender, text) {
  this.id = id;
  this.room_id = room_id;
  this.sender = sender;
  this.text = text;
}

var users = [];
var chatrooms = [];
var markdown = require( "markdown" ).markdown;

// Do the Socket.IO magic:
var io = socketio.listen(app);
io.sockets.on("connection", function(socket){
  // This callback runs when a new Socket.IO connection is established.

  //new user
  socket.on('new_user', function(data) {
    //check to see if user is already in the array
    var cur;
    for(var x=0; x<users.length; x++) {
      cur = users[x];
      if(cur.username == data.username) {
        // console.log(cur.id);
        if(cur.id == null) {
          cur.id = data.id;
          // console.log(cur.id);
          io.in(data.id).emit('new_user', {new_user:cur, users:users, chatrooms:chatrooms });
        }
        else {
          io.in(data.id).emit("error", {message:"this username already exists"});
        }
        return;
      }
    }

    var new_user = new User(data.username, data.id);
    users.push(new_user);
    io.sockets.emit('new_user', {new_user:new_user, users:users, chatrooms:chatrooms});
  });

  //new chatroom
  socket.on('new_chatroom', function(data) {
    var creator = data.creator;
    var new_chatroom = new Chatroom(data.chatroom_name, chatrooms.length, creator, data.password);
    chatrooms.push(new_chatroom);
    io.sockets.emit("new_chatroom", {chatroom:new_chatroom})
  });

  socket.on('join_room', function(data) {
    var joiner = data.user;
    var room = chatrooms[data.chatroom_id];
    var is_banned = false;
    for(var i=0; i<room.banned.length; i++) {
      if(room.banned[i].username==joiner.username) {
        is_banned = true;
        break;
      }
    }
    if(is_banned) {
      io.in(joiner.id).emit("error", {message:"You can't enter this room because you have been banned."});
    }
    else {
      var is_creator = false;
      if(room.creator==data.user.username) {
        is_creator = true;
      }
      if(data.password == room.password) {
        socket.join("chatroom" + room.id);
        room.members.push(joiner);
        io.in("chatroom" + room.id).emit("joined_room",{room_id:room.id, members:room.members,
          joiner:joiner, chatroom_name:room.name, is_creator:is_creator, messages:room.messages});
      }
      else {
        io.in(joiner.id).emit("error", {message:"incorrect password"});
      }
    }
  });

  //leave room
  socket.on('leave_room', function(data) {
    leaveRoom(data);
  });

  function leaveRoom(data) {
    var leaver = data.user;
    var room = chatrooms[data.chatroom_id];
    var members = room.members;
    for(var i=0; i < members.length; i++) {
      if(members[i].id == leaver.id) {
        room.members.splice(i, 1);
      }
    }
    socket.leave("chatroom" + room.id);
    io.in("chatroom" + room.id).emit("left_room",{room_id:room.id, members:room.members, leaver:leaver});
  }

  //message to chatroom
  socket.on('message_to_server', function(data) {
    // This callback runs when the server receives a new message from the client.
    var room = chatrooms[data.chatroom_id];
    var msg = markdown.toHTML(data.message);
    room.messages.push(new Message(room.messages.length, data.chatroom_id, data.sender.username, msg));
    io.in("chatroom" + data.chatroom_id).emit("message_to_client",{sender:data.sender, message:msg });
  });

  //message to individual user
	socket.on('private_message', function(data) {
		var receiver_id = data.user_id;
		socket.broadcast.to(receiver_id).emit("message_to_user",{sender:data.sender, private_message:data.private_message});
	});

  //remove user
  socket.on('remove_user', function(data) {
    //get the user we are removing
    var removed;
    for(var j=0; j<users.length; j++) {
      if(users[j].id==data.user_id) {
        removed = users[j];
        break;
      }
    }
    var room = chatrooms[data.chatroom_id];
    var members = room.members;
    for(var k=0; k<members.length; k++) {
      if(members[k].id == removed.id) {
        room.members.splice(k, 1);
      }
    }
    var msg = "You have been temporarily removed from this chatroom.";
    if(data.type_of_removal=='ban') {
        msg = "You have been permenantly banned from this chatroom.";
        room.banned.push(removed);
    }
    io.in("chatroom" + room.id).emit("removed",{room_id:room.id, members:room.members, removed:removed, message:msg});
    io.sockets.sockets[removed.id].leave("chatroom" + room.id);
  })

  //disconnect client
  socket.on('client_disconnected', function(data) {
    if(data.chatroom_id != null) {
      leaveRoom(data);
    }
    //remove from users
    for(var l=0; l<users.length; l++) {
      if(users[l].id == data.user.id) {
        users[l].id = null;
        console.log(users[l]);
      }
    }
  })
});
