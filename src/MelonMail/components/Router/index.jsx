import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { logout, changeAccount, fetchContacts } from '../../actions/auth';
import { getBalance, initialAppSetup } from '../../actions/utility';
import eth from '../../services/ethereumService';

import Auth from '../Auth/';
import App from '../Mail/App/';

class Router extends Component {
  constructor() {
    super();

    this.state = {};
  }

  componentWillMount() {
    if (window.web3 !== undefined) {
      setInterval(() => {
        eth.getAccount()
          .then((account) => {
            if (this.props.user.activeAccount !== account && account) {
              this.props.logout();
              this.props.changeAccount(account);
              this.props.getBalance();
              // DEPRECATED
              // this.props.fetchContacts();
            }
          })
          .catch(() => {
            console.log('Log in to metamask.');
          });
      }, 500);
    }

    this.props.initialAppSetup({
      useLocalStorage: this.props.useLocalStorage,
      defaultDomain: this.props.defaultDomain,
    });
  }

  render() {
    return (
      <div className="melonmail-wrapper">
        {
          this.props.router.path === '/' &&
          <App />
        }
        {
          this.props.router.path === 'auth' &&
          <Auth />
        }
      </div>
    );
  }
}

Router.propTypes = {
  user: PropTypes.shape({
    activeAccount: PropTypes.string.isRequired,
  }).isRequired,
  router: PropTypes.shape({
    path: PropTypes.string.isRequired,
  }).isRequired,
  path: PropTypes.string.isRequired,
  logout: PropTypes.func.isRequired,
  changeAccount: PropTypes.func.isRequired,
  getBalance: PropTypes.func.isRequired,
  initialAppSetup: PropTypes.func.isRequired,

  useLocalStorage: PropTypes.bool.isRequired,
  defaultDomain: PropTypes.string.isRequired,
};

Router.defaultProps = {
  path: 'auth',
};

const mapStateToProps = state => state;
const mapDispatchToProps = dispatch => bindActionCreators({
  logout,
  changeAccount,
  fetchContacts,
  getBalance,
  initialAppSetup,
}, dispatch);

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(Router);

