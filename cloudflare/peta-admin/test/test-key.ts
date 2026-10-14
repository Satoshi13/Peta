// Public RFC 8032 test vector; it is never a production secret.
export const TEST_SEED = btoa(String.fromCharCode(..."9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60".match(/../g)!.map(s => parseInt(s, 16))));
