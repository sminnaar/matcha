import React, { Component } from 'react';
import { hot } from 'react-hot-loader';

class UserProfile extends React.Component {
  render() {
    return (
      <h1>UserProfile Component</h1>
    );
  }
}

export default hot(module)(UserProfile);