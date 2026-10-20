import { Component } from 'react';

export default class PageBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="panel" role="alert">
      <span className="eyebrow">PAGE UNAVAILABLE</span><h2>This page could not be displayed</h2>
      <p>Your session is still active. Try again or use the navigation to open another page.</p>
      <button className="primary" onClick={() => this.setState({ failed: false })}>Try again</button>
    </section>;
    return this.props.children;
  }
}
