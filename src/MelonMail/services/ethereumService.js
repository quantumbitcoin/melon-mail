import uniqBy from 'lodash/uniqBy';

import config from './config.json';
import { generateKeys } from './cryptoService';

const networks = {
  mainnet: '1',
  morden: '2',
  ropsten: '3',
  kovan: '42',
};
const NETWORK_ID = networks.kovan;
let mailContract;

try {
  mailContract = web3.eth.contract(config.abi).at(config.contractAddress);
} catch (e) {
  console.log(e);
}

const getWeb3Status = () =>
  new Promise((resolve, reject) => {
    if (!web3) {
      return reject({
        message: 'NOT_FOUND',
      });
    }

    return web3.version.getNetwork((err, netId) => {
      if (netId.toString() !== NETWORK_ID) {
        return reject({
          message: 'WRONG_NETWORK',
        });
      }

      return resolve();
    });
  });

const getAccount = () => {
  if (!web3.eth.accounts || !web3.eth.accounts.length) { return false; }

  return web3.eth.accounts[0];
};

const getBalance = () => {
  const account = getAccount();
  if (!web3.isAddress(account)) {
    return Promise.resolve(0);
  }
  return new Promise((resolve, reject) => {
    web3.eth.getBalance(getAccount(), (error, balance) => {
      if (error) {
        return reject({
          message: error,
        });
      }

      return resolve(parseFloat(web3.fromWei(balance)));
    });
  });
};

const checkRegistration = () =>
  new Promise((resolve, reject) => {
    mailContract.BroadcastPublicKey(
      {
        addr: getAccount(),
      },
      {
        fromBlock: 0,
        toBlock: 'latest',
      },
    )
      .get((error, events) => {
        if (!events.length) {
          return reject({
            error: false,
            notRegistered: true,
            message: 'User not registered.',
          });
        }
        if (error) {
          return reject({
            error: true,
            message: error,
          });
        }
        return resolve({
          mail: web3.toAscii(events[0].args.username),
          address: events[0].args.addr,
          startingBlock: events[0].blockNumber,
        });
      });
  });

const signString = (account, stringToSign) =>
  new Promise((resolve, reject) => {
    web3.personal.sign(web3.fromUtf8(stringToSign), account, (error, result) => {
      if (error) {
        return reject(error);
      }
      return resolve(result);
    });
  });

const getBlockNumber = () =>
  new Promise((resolve, reject) => {
    web3.eth.getBlockNumber((error, latestBlock) => {
      if (error) {
        return reject(error);
      }

      return resolve(latestBlock);
    });
  });

const checkMailAddress = email =>
  new Promise((resolve, reject) => {
    mailContract.BroadcastPublicKey(
      {
        username: web3.fromAscii(email),
      },
      {
        fromBlock: 0,
        toBlock: 'latest',
      })
      .get((error, events) => {
        if (events.length > 0) {
          return reject({
            message: 'Username is already taken.',
          });
        }

        if (error) {
          return reject({
            message: error,
            events: null,
          });
        }

        return resolve({
          message: 'Username is available.',
        });
      });
  });

/* Calls registerUser function from the contract code */

const _registerUser = (mailAddress, signedString, mailHash, threadHash) =>
  new Promise((resolve, reject) => {
    const { privateKey, publicKey } = generateKeys(signedString);
    console.log(mailAddress, signedString, mailHash, threadHash);
    mailContract.registerUser(mailAddress, publicKey, mailHash, threadHash, (error) => {
      if (error) {
        return reject({
          message: error,
        });
      }

      return getBlockNumber()
        .then((startingBlock) => {
          resolve({
            publicKey,
            privateKey,
            mailAddress,
            address: getAccount(),
            startingBlock,
          });
        })
        .catch(() => {
          resolve({
            publicKey,
            privateKey,
            mailAddress,
            address: getAccount(),
            startingBlock: 0,
          });
        });
    });
  });

/* Scans the blockchain to find the public key for a user */

const _getPublicKey = email =>
  new Promise((resolve, reject) => {
    mailContract.BroadcastPublicKey(
      {
        username: web3.fromAscii(email),
      },
      {
        fromBlock: 0,
        toBlock: 'latest',
      })
      .get((error, events) => {
        if (error) {
          return reject({
            message: error,
            events: null,
          });
        }

        if (!events.length) {
          return reject({
            message: 'User not found!',
            events,
          });
        }

        return resolve({
          address: events[0].args.addr,
          publicKey: events[0].args.publicKey,
        });
      });
  });

/* Subscribes to the mail send event */

const listenForMails = callback =>
  getBlockNumber()
    .then((startingBlock) => {
      mailContract.SendEmail(
        {
          to: getAccount(),
        },
        {
          fromBlock: startingBlock,
          toBlock: 'latest',
        })
        .watch((error, event) => {
          if (error) {
            console.log(error);
          }
          callback(event, 'inbox');
        });

      mailContract.SendEmail(
        {
          from: getAccount(),
        },
        {
          fromBlock: startingBlock,
          toBlock: 'latest',
        })
        .watch((error, event) => {
          if (error) {
            console.log(error);
          }
          console.log('Mail event: Received an email', event);
          callback(event, 'outbox');
        });
    });

const getMails = (folder, fetchToBlock, blocksToFetch) => {
  console.log(`Fetching emails with batch size of ${blocksToFetch} blocks`);
  return getBlockNumber()
    .then((currentBlock) => {
      const filter = folder === 'inbox' ? { to: getAccount() } : { from: getAccount() };
      const fetchTo = fetchToBlock === null ? currentBlock : fetchToBlock;
      return new Promise((resolve, reject) => {
        mailContract.SendEmail(
          filter,
          {
            fromBlock: fetchTo - blocksToFetch,
            toBlock: fetchTo,
          })
          .get((error, events) => {
            if (error) {
              return reject({
                message: error,
              });
            }
            const filteredEvents = uniqBy(events.reverse(), 'args.threadId');
            return resolve({
              mailEvents: filteredEvents,
              fromBlock: fetchTo - blocksToFetch,
            });
          });
      });
    });
};

const getThread = (threadId, afterBlock) =>
  new Promise((resolve, reject) => {
    mailContract.SendEmail({ threadId }, {
      fromBlock: afterBlock,
      toBlock: 'latest',
    }).get((error, events) => {
      if (error) {
        return reject({
          message: error,
        });
      }
      return resolve(events.pop());
    });
  });

const _sendEmail = (toAddress, mailHash, threadHash, threadId) =>
  new Promise((resolve, reject) => {
    mailContract.sendEmail(toAddress, mailHash, threadHash, threadId, (error, result) => {
      if (error) {
        return reject({
          message: error,
        });
      }

      return resolve(result);
    });
  });

const signIn = () => new Promise((resolve, reject) => {
  signString(getAccount(), config.stringToSign)
    .then((signedString) => {
      const { privateKey, publicKey } = generateKeys(signedString);
      resolve({
        status: true,
        privateKey,
        publicKey,
      });
    })
    .catch((error) => {
      reject({
        message: error,
      });
    });
});

const fetchAllEvents = (folder) => {
  const filter = folder === 'inbox' ? { to: getAccount() } : { from: getAccount() };
  return new Promise((resolve, reject) => {
    mailContract.SendEmail(
      filter,
      {
        fromBlock: 0,
        toBlock: 'latest',
      })
      .get((error, events) => {
        if (error) {
          return reject({
            message: error,
          });
        }
        const filteredEvents = uniqBy(events, folder === 'inbox' ? 'args.from' : 'args.to');
        return resolve(filteredEvents);
      });
  });
};

const getAddressInfo = address =>
  new Promise((resolve) => {
    mailContract.BroadcastPublicKey(
      {
        addr: address,
      },
      {
        fromBlock: 0,
        toBlock: 'latest',
      },
    ).get((error, events) => {
      resolve(events);
    });
  });

export default {
  getWeb3Status,
  getAccount,
  signString,
  listenForMails,
  _registerUser,
  _getPublicKey,
  _sendEmail,
  checkRegistration,
  checkMailAddress,
  signIn,
  getMails,
  getThread,
  getBalance,
  fetchAllEvents,
  getAddressInfo,
};
