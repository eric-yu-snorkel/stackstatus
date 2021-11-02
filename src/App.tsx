import React from "react";
import logo from "./logo.png";
import "./App.css";

let GITHUB_PERSONAL_ACCESS_TOKEN: string | null;
try {
  GITHUB_PERSONAL_ACCESS_TOKEN = require("./github_personal_access_token.json");
} catch {
  GITHUB_PERSONAL_ACCESS_TOKEN = null;
}

function App(): JSX.Element {
  if (GITHUB_PERSONAL_ACCESS_TOKEN == null) {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <p>
            Please create a{" "}
            <a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token">
              GitHub Personal Access Token
            </a>{" "}
            and then create <code>src/github_personal_access_token.json</code>{" "}
            with your token in double quotes.
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <p>{GITHUB_PERSONAL_ACCESS_TOKEN}</p>
      </header>
    </div>
  );
}

export default App;
