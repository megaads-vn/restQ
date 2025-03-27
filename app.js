global.__dir = __dirname;
const DbMigration = require(__dir + "/db-migration");

// DbMigration.migrate().then(() => {
//     require(__dir + "/core/app/start").start();
// });
require(__dir + "/core/app/start").start();

