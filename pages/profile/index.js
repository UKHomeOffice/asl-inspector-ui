const bodyParser = require('body-parser');
const { page } = require('@asl/service/ui');

const roles = ['asruAdmin', 'asruLicensing', 'asruInspector'];

module.exports = settings => {
  const app = page({
    ...settings,
    root: __dirname
  });

  app.use(bodyParser.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.locals.static.roles = roles;
    res.locals.static.canAdmin = req.user.profile.asruAdmin && req.profileId !== req.user.profile.id;
    next();
  });

  app.post('/', (req, res, next) => {
    let data;
    if (req.body.roles) {
      data = roles.reduce((map, role) => {
        return { ...map, [role]: req.body.roles.includes(role) };
      }, {});
    } else if (req.body.asruUser) {
      data = {
        asruUser: req.body.asruUser === 'true'
      };
    }
    return req.api(`/profile/${req.profileId}`, { method: 'PUT', json: { data } })
      .then(() => {
        req.notification({ key: 'success' });
        res.redirect(req.originalUrl);
      })
      .catch(next);

  });

  app.get('/', (req, res, next) => {
    req.breadcrumb('profile.view');
    return req.api(`/profile/${req.profileId}`)
      .then(({ json: { data, meta } }) => {
        res.locals.model = data;
      })
      .then(() => next())
      .catch(next);
  });

  app.get('/', (req, res) => res.sendResponse());

  return app;
};