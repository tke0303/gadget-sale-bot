require('dotenv').config();
const { runTweetPost } = require('./index');

runTweetPost()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
