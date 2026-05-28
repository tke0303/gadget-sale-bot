require('dotenv').config();
const { runArticlePost } = require('./index');

runArticlePost()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
