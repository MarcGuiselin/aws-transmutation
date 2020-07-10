const { webhook } = require('./events/index');

exports.handler = async (event, context, callback) => {
  console.log('RECEIVED EVENT', JSON.stringify(event));

  // This is a github webhook, so let's process it!
  if(event.routeKey == "POST /" && event.headers){
    try {
      // Process event
      const msg = webhook(event);

      // Success
      console.log('Exited returning success:', msg);
      callback(null, {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(msg),
      });
    } catch(err){
      // Error
      console.error('Exited with error:', err);
      callback(err, {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({message: 'Bad Request. See cloudwatch logs.'}),
      });
    }
  }
};