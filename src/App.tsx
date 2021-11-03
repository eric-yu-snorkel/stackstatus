import { Octokit } from "@octokit/core";
import { components } from "@octokit/openapi-types";
import React, { useEffect } from "react";
import logo from "./logo.png";
import "./App.css";

let GITHUB_PERSONAL_ACCESS_TOKEN: string | null;
try {
  GITHUB_PERSONAL_ACCESS_TOKEN = require("./github_personal_access_token.json");
} catch {
  GITHUB_PERSONAL_ACCESS_TOKEN = null;
}

// TODO XXX - for some reason, hot reloading no longer works - could the Tailwind installation be responsible?
function App(): JSX.Element {
  // TODO XXX make sure this still looks right, now that we've installed Tailwind and replaced index.css
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

  return <StackStatus />;
}

type PR = components["schemas"]["pull-request"];

interface StackPRStatusInfo {
  prNumber: number;
  title: string;
  overallStatus: "success" | "failure" | "error" | "pending";
  statuses: Array<{
    id: number;
    nameOfCheck: string;
    status: "success" | "failure" | "error" | "pending";
    ciUrl: string;
  }>;
  reviewerStatuses: {
    [login: string]: ReviewerStatus;
  };
}

function StackStatus(): JSX.Element {
  const [statusInfos, setStatusInfos] =
    React.useState<Array<StackPRStatusInfo> | null>(null);
  useEffect(() => {
    const octokit = new Octokit({ auth: GITHUB_PERSONAL_ACCESS_TOKEN });
    // @ts-ignore
    window.octokit = octokit;
    (async () => {
      const { data: topPR }: { data: PR } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner: "snorkel-ai",
          repo: "strap",
          pull_number: 12505,
        }
      );
      if (topPR.body == null) {
        throw new Error("PR has no description.");
      }
      const ghstackFooterMatch = /Stack from.*\n/.exec(topPR.body);
      if (ghstackFooterMatch == null) {
        throw new Error(
          "ghstack footer not found. The PR may not have been created with ghstack, or the footer may have been deleted."
        );
      }
      const ghstackFooterContent = topPR.body.slice(
        ghstackFooterMatch.index + ghstackFooterMatch[0].length
      );
      const ghstackPRNumbers = [
        ...ghstackFooterContent.matchAll(/\*.*#([0-9]+).*\n/g),
      ]
        .reverse()
        .map((match) => Number(match[1]));
      if (ghstackPRNumbers.length === 0) {
        throw new Error(
          "Could not find any PRs in the ghstack footer. The footer may be malformed."
        );
      }
      const ghstackPRs: Array<PR> = await Promise.all<PR>(
        ghstackPRNumbers.map(async (prNumber) => {
          const { data }: { data: PR } = await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}",
            {
              owner: "snorkel-ai",
              repo: "strap",
              pull_number: prNumber,
            }
          );
          return data;
        })
      );
      const ghstackPRStatusInfos: Array<StackPRStatusInfo> = await Promise.all(
        ghstackPRs.map(async (pr: PR) => {
          const {
            data: prData,
          }: {
            data: {
              state: string;
              statuses: Array<components["schemas"]["simple-commit-status"]>;
            };
          } = await octokit.request(
            // We could also use the check-runs endpoint, but for some reason it doesn't seem to return anything from CircleCI
            "GET /repos/{owner}/{repo}/commits/{ref}/status",
            {
              owner: "snorkel-ai",
              repo: "strap",
              ref: pr.head.ref,
            }
          );
          const {
            data: reviews,
          }: { data: Array<components["schemas"]["pull-request-review"]> } =
            await octokit.request(
              "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
              {
                owner: "snorkel-ai",
                repo: "strap",
                pull_number: pr.number,
              }
            );
          const prStatusInfo: StackPRStatusInfo = {
            prNumber: pr.number,
            title: pr.title,
            overallStatus: prData.state as
              | "success"
              | "failure"
              | "error"
              | "pending",
            statuses: prData.statuses.map(
              (status) =>
                ({
                  id: status.id,
                  nameOfCheck: status.context,
                  status: status.state as
                    | "success"
                    | "failure"
                    | "error"
                    | "pending",
                  ciUrl: status.target_url,
                } as const)
            ),
            reviewerStatuses: aggregateReviewerStatuses(
              pr.requested_reviewers ?? [],
              reviews
            ),
          };
          return prStatusInfo;
        })
      );
      setStatusInfos(ghstackPRStatusInfos);
    })();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center">
      {/* Input */}
      <div className="inline-block">
        <img src={logo} alt="stackstatus" />
        <input type="input"></input>
      </div>
      {/* Results */}
      {statusInfos != null ? (
        <table>
          <thead>
            <tr>
              <th className="border p-4">Reviewers</th>
              <th className="border p-4">Review</th>
              <th className="border p-4">CI</th>
              <th className="border p-4">PR</th>
            </tr>
          </thead>
          <tbody>
            {statusInfos.map((prStatusInfo: StackPRStatusInfo) => {
              return (
                <tr key={prStatusInfo.prNumber}>
                  <td className="border p-4">
                    <div className="flex">
                      {Object.entries(prStatusInfo.reviewerStatuses).map(
                        ([login, { avatar_url }]) => (
                          <img
                            key={login}
                            className="w-8 h-8"
                            src={avatar_url}
                            alt={login}
                            title={login}
                          />
                        )
                      )}
                    </div>
                  </td>
                  {(() => {
                    // Some statuses may be missing, so we should err on the side of recommending some next action, rather than nothing.
                    // It's better to overcommunicate than to let a PR get stuck.

                    let displayInfo: { className: string; text: string };
                    if (
                      Object.values(prStatusInfo.reviewerStatuses).some(
                        ({ status }) => status === "CHANGES_REQUESTED"
                      )
                    ) {
                      displayInfo = {
                        className: "bg-red-400",
                        text: "❌ Make changes",
                      };
                    } else if (
                      Object.values(prStatusInfo.reviewerStatuses).some(
                        ({ status }) => status === "APPROVED"
                      )
                    ) {
                      displayInfo = { className: "", text: "✅ Approved" };
                    } else if (
                      Object.values(prStatusInfo.reviewerStatuses).some(
                        ({ status }) => status === "COMMENTED"
                      )
                    ) {
                      displayInfo = {
                        className: "bg-yellow-400",
                        text: "💬 Address comments",
                      };
                    } else {
                      displayInfo = {
                        className: "bg-yellow-400",
                        text: "📣 Bug people to review",
                      };
                    }

                    return (
                      <td className={`border p-4 ${displayInfo.className}`}>
                        {displayInfo.text}
                      </td>
                    );
                  })()}
                  <td className="border p-4">
                    {prStatusInfo.overallStatus !== "success"
                      ? prStatusInfo.statuses.map(
                          (checkStatus) =>
                            checkStatus.status !== "success" && (
                              <div key={checkStatus.id}>
                                <a
                                  // TODO XXX make this link blue in the right way
                                  className="text-blue-700"
                                  href={checkStatus.ciUrl}
                                >
                                  {getStatusIcon(checkStatus.status)}{" "}
                                  {checkStatus.nameOfCheck}
                                </a>
                              </div>
                            )
                        )
                      : null}
                  </td>
                  <td className="border p-4">
                    <a
                      // TODO XXX make this link blue in the right way
                      className="text-blue-700"
                      href={`https://github.com/snorkel-ai/strap/pull/${prStatusInfo.prNumber}`}
                    >
                      {getStatusIcon(prStatusInfo.overallStatus)}{" "}
                      {prStatusInfo.title}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function getStatusIcon(
  status: "success" | "failure" | "error" | "pending"
): string {
  switch (status) {
    case "success":
      return "✅";
    case "failure":
    case "error":
      return "❌";
    case "pending":
      return "⏳";
    default:
      throw new Error(`Unknown status: ${status}`);
  }
}

interface ReviewerStatus {
  id: components["schemas"]["simple-user"]["id"];
  avatar_url: components["schemas"]["simple-user"]["avatar_url"];
  status: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING";
}

// TODO XXX not sure what happens if a review gets dismissed - I don't even know if the API will tell us
// TODO XXX - this is generally not too reliable, so we should err on the side of recommending that the user take some action, rather than do nothing
function aggregateReviewerStatuses(
  requested_reviewers: Array<components["schemas"]["simple-user"]>,
  reviews: Array<components["schemas"]["pull-request-review"]>
): {
  [login: string]: ReviewerStatus;
} {
  const reviewerStatuses: { [login: string]: ReviewerStatus } = {};

  for (const reviewer of requested_reviewers) {
    reviewerStatuses[reviewer.login] = {
      id: reviewer.id,
      avatar_url: reviewer.avatar_url,
      status: "PENDING",
    };
  }

  for (const review of reviews) {
    if (review.user == null) {
      throw new Error("Review has no user");
    }
    if (!(review.user.login in reviewerStatuses)) {
      reviewerStatuses[review.user.login] = {
        id: review.user.id,
        avatar_url: review.user.avatar_url,
        status: "PENDING",
      };
    }
    const oldStatus = reviewerStatuses[review.user.login].status;
    const stateChange = review.state as
      | "APPROVED"
      | "CHANGES_REQUESTED"
      | "COMMENTED";
    if (!["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(stateChange)) {
      throw new Error(`Unknown state change: ${stateChange}`);
    }
    let newStatus = oldStatus;
    // TODO XXX not sure how to handle reviews getting re-requested
    switch (oldStatus) {
      case "APPROVED": {
        if (stateChange === "CHANGES_REQUESTED") {
          newStatus = "CHANGES_REQUESTED";
        }
        break;
      }
      case "CHANGES_REQUESTED": {
        if (stateChange === "APPROVED") {
          newStatus = "APPROVED";
        }
        break;
      }
      case "COMMENTED":
      case "PENDING": {
        newStatus = stateChange;
        break;
      }
      default:
        throw new Error(`Unknown status: ${oldStatus}`);
    }
    reviewerStatuses[review.user.login] = {
      ...reviewerStatuses[review.user.login],
      status: newStatus,
    };
  }

  // Filter out drive-by comments
  for (const login of Object.keys(reviewerStatuses)) {
    if (
      reviewerStatuses[login].status === "COMMENTED" &&
      // TODO XXX - requested_reviewers does not always include every reviewer that has ever been requested.
      !requested_reviewers.map(({ login }) => login).includes(login)
    ) {
      delete reviewerStatuses[login];
    }
  }

  return reviewerStatuses;
}

export default App;
