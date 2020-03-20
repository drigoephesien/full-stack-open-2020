import React from "react";

import { Switch, Route } from "react-router-dom";

import Authors from "./components/Authors";
import Books from "./components/Books";
import NewBook from "./components/NewBook";

const App = () => {
  return (
    <>
      <Switch>
        <Route path="/" exact>
          <Authors />
        </Route>
        <Route path="/books" exact>
          <Books />
        </Route>
        <Route path="/add" exact>
          <NewBook />
        </Route>
      </Switch>
    </>
  );
};

export default App;
