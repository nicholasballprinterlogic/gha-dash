import React, { useState, useEffect, useCallback } from 'react';

// Main App component for the GitHub Dashboard
function App() {
  // State for GitHub Personal Access Token (PAT)
  const [githubToken, setGithubToken] = useState('');
  // State to store the list of repositories (e.g., "owner/repo")
  const [repos, setRepos] = useState(() => {
    // Initialize repos from local storage, or an empty array if not found
    const savedRepos = localStorage.getItem('githubRepos');
    return savedRepos ? JSON.parse(savedRepos) : [];
  });
  localStorage.setItem('githubRepos', JSON.stringify([
    'printerlogic/snmp-custom-data',
    'printerlogic/api-gateway-app',
    'printerlogic/print-stats-api',
    'printerlogic/print-stats-worker',
    'printerlogic/event-bus-app',
    'printerlogic/service-client-status-service-api',
    'printerlogic/quota-management-app',
    'printerlogic/jobba-the-held-app',
    'printerlogic/heir-of-fangorn',
    'printerlogic/printer-admin-gw',
    'printerlogic/printer-api',
    'printerlogic/badge-reader-api',
    'printerlogic/docker-images-ops',
    'printerlogic/unleash',
  ]));
  // State to store the fetched data for each repository
  const [repoData, setRepoData] = useState({});
  // State for loading indicator
  const [loading, setLoading] = useState(false);
  // State for any error messages
  const [error, setError] = useState('');
  // State for new repository input
  const [newRepo, setNewRepo] = useState('');
  // State for the Trivy workflow file name
  const [trivyWorkflowFileName, setTrivyWorkflowFileName] = useState(() => {
    // Initialize workflow file name from local storage, or a default value
    const savedWorkflowName = localStorage.getItem('trivyWorkflowFileName');
    return savedWorkflowName || 'trivy-scan.yml'; // Default Trivy workflow file name
  });
  // State for deployment environments to monitor
  const [deploymentEnvironments, setDeploymentEnvironments] = useState(() => {
    // Initialize environments from local storage, or a default value
    const savedEnvironments = localStorage.getItem('deploymentEnvironments');
    return savedEnvironments ? JSON.parse(savedEnvironments) : ['service-stack', 'stage', 'canary', 'prod'];
  });
  // State for new environment input
  const [newEnvironment, setNewEnvironment] = useState('');


  // Effect to load GitHub token from local storage on initial render
  useEffect(() => {
    const savedToken = localStorage.getItem('githubToken');
    if (savedToken) {
      setGithubToken(savedToken);
    }
  }, []);

  // Effect to save repos, token, workflow name, and environments to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('githubRepos', JSON.stringify(repos));
  }, [repos]);

  useEffect(() => {
    localStorage.setItem('githubToken', githubToken);
  }, [githubToken]);

  useEffect(() => {
    localStorage.setItem('trivyWorkflowFileName', trivyWorkflowFileName);
  }, [trivyWorkflowFileName]);

  useEffect(() => {
    localStorage.setItem('deploymentEnvironments', JSON.stringify(deploymentEnvironments));
  }, [deploymentEnvironments]);


  // Helper to get standard status color for deployments (e.g., for non-success states)
  const getStatusColor = useCallback((status) => {
    switch (status) {
      case 'success':
        return 'bg-green-500';
      case 'failure':
      case 'error':
        return 'bg-red-500';
      case 'pending':
      case 'in_progress':
        return 'bg-yellow-500';
      case 'inactive':
      case 'cancelled':
        return 'bg-gray-400';
      default:
        return 'bg-blue-400'; // For unknown or neutral states
    }
  }, []);

  // Helper to get color for the timestamp text based on deployment age
  const getTimestampColor = useCallback((deploymentTimestamp) => {
    if (!deploymentTimestamp) {
      return 'text-gray-400'; // Default gray for N/A or invalid dates
    }

    const now = new Date();
    const deployDate = new Date(deploymentTimestamp);
    const diffInMilliseconds = now.getTime() - deployDate.getTime();
    const diffInWeeks = diffInMilliseconds / (1000 * 60 * 60 * 24 * 7);

    if (diffInWeeks < 2) { // Less than 2 weeks
      return 'text-green-400';
    } else if (diffInWeeks >= 2 && diffInWeeks < 4) { // 2 weeks to less than 4 weeks
      return 'text-yellow-400';
    } else if (diffInWeeks >= 4) { // 4 weeks or more
      return 'text-red-400';
    } else {
      return 'text-gray-400'; // Fallback
    }
  }, []);


  // Function to fetch deployment information, including the latest status and last successful timestamp
  const getDeploymentInfo = useCallback(async (owner, repo, environment) => {
    // Fetch up to 100 deployments to find the most recent successful one
    const url = `https://api.github.com/repos/${owner}/${repo}/deployments?environment=${environment}&per_page=100`;
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API error for deployment (${response.status}): ${errorText}`);
      }
      const deployments = await response.json();

      let latestDeploymentInfo = null;
      let lastSuccessfulDeploymentTimestamp = null;

      if (deployments.length > 0) {
        const latestDeployment = deployments[0];

        // Fetch the statuses for the latest deployment to get its actual current state
        const statusesUrl = latestDeployment.statuses_url;
        const statusesResponse = await fetch(statusesUrl, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        });
        if (!statusesResponse.ok) {
          const errorText = await statusesResponse.text();
          throw new Error(`GitHub API error for deployment statuses (${statusesResponse.status}): ${errorText}`);
        }
        const statuses = await statusesResponse.json();

        if (statuses.length > 0) {
          // Sort statuses by creation date to get the latest one
          const actualLatestStatus = statuses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
          latestDeploymentInfo = {
            status: actualLatestStatus.state, // Use the state from the actual latest status
            timestamp: actualLatestStatus.created_at,
            url: actualLatestStatus.url,
          };
        } else {
          // Fallback if no statuses found for the latest deployment
          latestDeploymentInfo = {
            status: latestDeployment.state, // Use the deployment object's state as a fallback
            timestamp: latestDeployment.created_at,
            url: latestDeployment.url,
          };
        }

        // Find the most recent successful deployment for the timestamp coloring
        for (const dep of deployments) {
          if (dep.state === 'success') { // This state is usually 'active' for successful deployments
            // We need to check its *statuses* to confirm 'success'
            const depStatusesUrl = dep.statuses_url;
            const depStatusesResponse = await fetch(depStatusesUrl, {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github.v3+json',
              },
            });
            if (depStatusesResponse.ok) {
              const depStatuses = await depStatusesResponse.json();
              const successStatus = depStatuses.find(s => s.state === 'success');
              if (successStatus) {
                lastSuccessfulDeploymentTimestamp = successStatus.created_at;
                break; // Found the most recent successful one
              }
            }
          }
        }
      }

      return {
        latest: latestDeploymentInfo,
        lastSuccessTimestamp: lastSuccessfulDeploymentTimestamp,
      };

    } catch (err) {
      console.error(`Error fetching deployment info for ${owner}/${repo} (${environment}):`, err);
      return {
        latest: { status: 'error', timestamp: new Date().toISOString(), url: '#' },
        lastSuccessTimestamp: null,
      };
    }
  }, [githubToken]);


  // Function to fetch the latest workflow run conclusion for a given repo and workflow name
  // This function is updated to also fetch and parse logs for vulnerability summaries
  const getLatestWorkflowRuns = useCallback(async (owner, repo, workflowName, count = 5) => {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?workflow_id=${workflowName}&per_page=${count}`;
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API error for workflow runs (${response.status}): ${errorText}`);
      }
      const data = await response.json();

      if (data.workflow_runs && data.workflow_runs.length > 0) {
        // Use Promise.all to fetch details for all runs concurrently
        const runsWithDetails = await Promise.all(data.workflow_runs.map(async (run) => {
          let vulnerabilitySummary = null;
          try {
            // Fetch jobs for the current run
            const jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`;
            const jobsResponse = await fetch(jobsUrl, {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github.v3+json',
              },
            });
            if (!jobsResponse.ok) {
              const errorText = await jobsResponse.text();
              throw new Error(`GitHub API error for jobs (${jobsResponse.status}): ${errorText}`);
            }
            const jobsData = await jobsResponse.json();
            // Find a job that likely contains Trivy scan output (heuristic: name includes 'trivy' or 'scan')
            const trivyJob = jobsData.jobs.find(job =>
                job.name.toLowerCase().includes('trivy') ||
                job.name.toLowerCase().includes('scan')
            );

            if (trivyJob) {
              // Fetch logs for the identified Trivy job
              const logsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${trivyJob.id}/logs`;
              const logsResponse = await fetch(logsUrl, {
                headers: {
                  Authorization: `Bearer ${githubToken}`,
                  Accept: 'application/vnd.github.v3+json', // Logs are typically plain text but this header works
                },
              });
              if (!logsResponse.ok) {
                const errorText = await logsResponse.text();
                throw new Error(`GitHub API error for job logs (${logsResponse.status}): ${errorText}`);
              }
              const logsText = await logsResponse.text(); // Get logs as plain text

              // Regex to find the vulnerability summary line, similar to: "Total: 1 (LOW: 0, MEDIUM: 1, HIGH: 0, CRITICAL: 0)"
              const regex = /Total: \d+ \(LOW: (\d+), MEDIUM: (\d+), HIGH: (\d+), CRITICAL: (\d+)\)/;
              const match = logsText.match(regex);
              if (match) {
                vulnerabilitySummary = match[0];
                // Store individual counts for highlighting logic
                run.lowCount = parseInt(match[1]);
                run.mediumCount = parseInt(match[2]);
                run.highCount = parseInt(match[3]);
                run.criticalCount = parseInt(match[4]);
              }
            }
          } catch (jobErr) {
            console.warn(`Could not fetch job/log details for run ${run.id} in ${owner}/${repo}:`, jobErr);
            vulnerabilitySummary = 'Error fetching details';
          }
          return {
            conclusion: run.conclusion,
            timestamp: run.created_at,
            url: run.html_url,
            id: run.id, // Ensure ID is present for unique keys in lists
            vulnerabilitySummary: vulnerabilitySummary,
            lowCount: run.lowCount || 0, // Ensure default 0 if not found
            mediumCount: run.mediumCount || 0,
            highCount: run.highCount || 0,
            criticalCount: run.criticalCount || 0,
          };
        }));
        return runsWithDetails;
      }
    } catch (err) {
      console.error(`Error fetching workflow runs for ${owner}/${repo} (${workflowName}):`, err);
      return [];
    }
    return [];
  }, [githubToken]); // Recreate if githubToken changes

  // Function to fetch all data for all monitored repositories
  const fetchAllRepoData = useCallback(async () => {
    if (!githubToken) {
      setError('Please enter your GitHub Personal Access Token.');
      setRepoData({});
      return;
    }
    setLoading(true);
    setError('');
    const newRepoData = {};

    for (const repoFullName of repos) {
      const [owner, repo] = repoFullName.split('/');
      if (!owner || !repo) {
        newRepoData[repoFullName] = { error: 'Invalid repository format' };
        continue;
      }

      const deployments = {};
      for (const env of deploymentEnvironments) {
        deployments[env] = await getDeploymentInfo(owner, repo, env); // Use getDeploymentInfo
      }

      // Fetch multiple Trivy scan runs with their details
      const trivyScans = await getLatestWorkflowRuns(owner, repo, trivyWorkflowFileName);

      newRepoData[repoFullName] = {
        deployments,
        trivyScans,
      };
    }
    setRepoData(newRepoData);
    setLoading(false);
  }, [githubToken, repos, trivyWorkflowFileName, deploymentEnvironments, getDeploymentInfo, getLatestWorkflowRuns]); // Recreate if these dependencies change

  // Effect to fetch data when repos or token changes
  useEffect(() => {
    fetchAllRepoData();
  }, [fetchAllRepoData]);

  // Handler for adding a new repository
  const handleAddRepo = () => {
    const trimmedRepo = newRepo.trim();
    if (trimmedRepo && !repos.includes(trimmedRepo)) {
      setRepos([...repos, trimmedRepo]);
      setNewRepo('');
    }
  };

  // Handler for removing a repository
  const handleRemoveRepo = (repoToRemove) => {
    setRepos(repos.filter(repo => repo !== repoToRemove));
    setRepoData(prevData => {
      const newData = { ...prevData };
      delete newData[repoToRemove];
      return newData;
    });
  };

  // Handler for adding a new environment
  const handleAddEnvironment = () => {
    const trimmedEnv = newEnvironment.trim().toLowerCase();
    if (trimmedEnv && !deploymentEnvironments.includes(trimmedEnv)) {
      setDeploymentEnvironments([...deploymentEnvironments, trimmedEnv]);
      setNewEnvironment('');
    }
  };

  // Handler for removing an environment
  const handleRemoveEnvironment = (envToRemove) => {
    setDeploymentEnvironments(deploymentEnvironments.filter(env => env !== envToRemove));
  };

  // Helper to format date
  const formatDate = (isoString) => {
    if (!isoString || isoString === '#') return 'N/A';
    try {
      return new Date(isoString).toLocaleString();
    } catch (e) {
      return 'Invalid Date';
    }
  };


  // Helper to get color for workflow run conclusions
  const getConclusionColor = (conclusion) => {
    switch (conclusion) {
      case 'success':
        return 'bg-green-500';
      case 'failure':
        return 'bg-red-500';
      case 'neutral':
        return 'bg-gray-500';
      case 'cancelled':
        return 'bg-yellow-500';
      case 'skipped':
        return 'bg-indigo-500';
      case 'timed_out':
        return 'bg-orange-500';
      case 'action_required':
        return 'bg-purple-500';
      default:
        return 'bg-blue-400';
    }
  };

  // Helper to determine if Trivy summary should be highlighted
  const shouldHighlightTrivySummary = (run) => {
    return run.lowCount > 0 || run.mediumCount > 0 || run.highCount > 0 || run.criticalCount > 0;
  };

  return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-gray-100 p-4 font-inter">
        <div className="container mx-auto p-6 bg-gray-800 rounded-xl shadow-2xl">
          <h1 className="text-4xl font-extrabold text-center mb-8 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
            GitHub Repo Status Dashboard
          </h1>

          {/* GitHub Token Input */}
          <div className="mb-8 p-6 bg-gray-700 rounded-lg shadow-inner">
            <label htmlFor="githubToken" className="block text-lg font-semibold mb-2 text-purple-300">
              GitHub Personal Access Token (PAT):
            </label>
            <input
                type="password"
                id="githubToken"
                className="w-full p-3 rounded-md bg-gray-900 border border-gray-600 focus:border-purple-500 focus:ring focus:ring-purple-500 focus:ring-opacity-50 text-white"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="Enter your GitHub PAT (e.g., gh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)"
            />
            <p className="text-sm text-gray-400 mt-2">
              Your PAT is stored locally in your browser. It needs 'repo' (or 'repo:status') and 'actions:read' scopes.
            </p>
          </div>

          {/* Configuration Section */}
          <div className="mb-8 p-6 bg-gray-700 rounded-lg shadow-inner">
            <h2 className="text-2xl font-bold mb-4 text-pink-300">Configuration</h2>

            {/* Trivy Workflow File Name */}
            <div className="mb-4">
              <label htmlFor="trivyWorkflow" className="block text-lg font-semibold mb-2 text-purple-300">
                Trivy Workflow File Name:
              </label>
              <input
                  type="text"
                  id="trivyWorkflow"
                  className="w-full p-3 rounded-md bg-gray-900 border border-gray-600 focus:border-purple-500 focus:ring focus:ring-purple-500 focus:ring-opacity-50 text-white"
                  value={trivyWorkflowFileName}
                  onChange={(e) => setTrivyWorkflowFileName(e.target.value)}
                  placeholder="e.g., trivy-scan.yml"
              />
              <p className="text-sm text-gray-400 mt-2">
                The exact filename of your Trivy GitHub Actions workflow (e.g., `trivy-scan.yml`).
              </p>
            </div>

            {/* Deployment Environments */}
            <div>
              <label className="block text-lg font-semibold mb-2 text-purple-300">
                Deployment Environments to Monitor:
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {deploymentEnvironments.map((env) => (
                    <span key={env} className="flex items-center bg-purple-600 text-white text-sm px-3 py-1 rounded-full shadow-md">
                                    {env}
                      <button
                          onClick={() => handleRemoveEnvironment(env)}
                          className="ml-2 text-purple-200 hover:text-white focus:outline-none"
                      >
                                        &times;
                                    </button>
                                </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                    type="text"
                    className="flex-grow p-3 rounded-md bg-gray-900 border border-gray-600 focus:border-purple-500 focus:ring focus:ring-purple-500 focus:ring-opacity-50 text-white"
                    value={newEnvironment}
                    onChange={(e) => setNewEnvironment(e.target.value)}
                    placeholder="Add new environment (e.g., dev)"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleAddEnvironment();
                      }
                    }}
                />
                <button
                    onClick={handleAddEnvironment}
                    className="px-5 py-3 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-md shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Add Repository Section */}
          <div className="mb-8 p-6 bg-gray-700 rounded-lg shadow-inner">
            <h2 className="text-2xl font-bold mb-4 text-pink-300">Manage Repositories</h2>
            <div className="flex gap-2 mb-4">
              <input
                  type="text"
                  className="flex-grow p-3 rounded-md bg-gray-900 border border-gray-600 focus:border-purple-500 focus:ring focus:ring-purple-500 focus:ring-opacity-50 text-white"
                  value={newRepo}
                  onChange={(e) => setNewRepo(e.target.value)}
                  placeholder="Add new repo (e.g., PrinterLogic/snmp-custom-data)"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddRepo();
                    }
                  }}
              />
              <button
                  onClick={handleAddRepo}
                  className="px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-md shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
              >
                Add Repo
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {repos.map((repo) => (
                  <span key={repo} className="flex items-center bg-gray-600 text-white text-sm px-3 py-1 rounded-full shadow-md">
                                {repo}
                    <button
                        onClick={() => handleRemoveRepo(repo)}
                        className="ml-2 text-gray-300 hover:text-white focus:outline-none"
                    >
                                    &times;
                                </button>
                            </span>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center gap-4 mb-8">
            <button
                onClick={fetchAllRepoData}
                disabled={loading || !githubToken || repos.length === 0}
                className={`px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full shadow-xl transition duration-300 ease-in-out transform hover:scale-105 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {loading ? 'Refreshing...' : 'Refresh All Statuses'}
            </button>
            <button
                onClick={() => {
                  setRepos([]);
                  setRepoData({});
                  setError('');
                }}
                className="px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-full shadow-xl transition duration-300 ease-in-out transform hover:scale-105"
            >
              Clear All Repos
            </button>
          </div>

          {/* Error Display */}
          {error && (
              <div className="bg-red-800 text-white p-4 rounded-lg mb-8 shadow-md">
                <p className="font-bold">Error:</p>
                <p>{error}</p>
              </div>
          )}

          {/* Dashboard Display */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
            {repos.length === 0 && !loading && !error && (
                <p className="col-span-full text-center text-gray-400 text-xl">
                  Add some repositories to start monitoring!
                </p>
            )}

            {repos.map((repoFullName) => {
              const data = repoData[repoFullName];
              // const [owner, repoName] = repoFullName.split('/'); // owner and repoName are not directly used in rendering repo card title

              return (
                  <div key={repoFullName} className="bg-gray-700 rounded-xl shadow-lg p-6 border border-gray-600 hover:border-purple-500 transition duration-200 ease-in-out transform hover:scale-[1.02]">
                    <h3 className="text-2xl font-bold mb-4 text-purple-400 flex items-center justify-between">
                      <a
                          href={`https://github.com/${repoFullName}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                      >
                        {repoFullName}
                      </a>
                    </h3>

                    {/* Deployment Statuses */}
                    <div className="mb-4">
                      <h4 className="text-lg font-semibold text-pink-200 mb-2">Deployments:</h4>
                      {data?.deployments && Object.keys(data.deployments).length > 0 ? (
                          Object.entries(data.deployments).map(([env, deploymentInfo]) => {
                            // Add console log here
                            console.log('Deployment Info for', env, ':', deploymentInfo);
                            return (
                                <div key={env} className="flex items-center mb-1">
                                  <span className="font-medium text-gray-300 w-24 capitalize">{env}:</span>
                                  {deploymentInfo?.latest ? (
                                      <a
                                          href={deploymentInfo.latest.url.replace('/statuses', '')} // Link to the deployment itself
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`px-3 py-1 rounded-full text-sm font-bold text-white ${getStatusColor(deploymentInfo.latest.status)} mr-2 hover:opacity-80`} // Reverted to getStatusColor
                                      >
                                        {deploymentInfo.latest.status || 'N/A'}
                                      </a>
                                  ) : (
                                      <span className="px-3 py-1 rounded-full text-sm font-bold text-white bg-gray-500 mr-2">
                                                            No Deployments
                                                        </span>
                                  )}

                                  <span className={`text-xs ${getTimestampColor(deploymentInfo?.latest?.timestamp)}`}>
                                                        {deploymentInfo?.latest ? formatDate(deploymentInfo.latest.timestamp) : ''}
                                                    </span>
                                </div>
                            );
                          })
                      ) : (
                          <p className="text-gray-400 text-sm">No deployment data available or environments configured.</p>
                      )}
                    </div>

                    {/* Trivy Scan Status - Last 5 Runs with Findings */}
                    <div>
                      <h4 className="text-lg font-semibold text-pink-200 mb-2">Trivy Scan (Last 5 Runs):</h4>
                      {data?.trivyScans && data.trivyScans.length > 0 ? (
                          <div className="space-y-1">
                            {data.trivyScans.map((run, index) => (
                                <div key={run.id || index} className="flex flex-col mb-2 p-2 bg-gray-600 rounded-md">
                                  <div className="flex items-center text-sm mb-1">
                                    <span className="font-medium text-gray-300 w-16">Run {index + 1}:</span>
                                    <a
                                        href={run.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`px-2 py-0.5 rounded-full text-xs font-bold text-white ${getConclusionColor(run.conclusion)} mr-2 hover:opacity-80`}
                                    >
                                      {run.conclusion || 'N/A'}
                                    </a>
                                    <span className="text-xs text-gray-400">
                                                            {formatDate(run.timestamp)}
                                                        </span>
                                  </div>
                                  {run.vulnerabilitySummary && (
                                      <p className={`text-xs ml-16 ${shouldHighlightTrivySummary(run) ? 'text-yellow-400' : 'text-gray-300'}`}>
                                        {run.vulnerabilitySummary}
                                      </p>
                                  )}
                                  {!run.vulnerabilitySummary && run.conclusion !== 'error' && (
                                      <p className="text-xs text-gray-400 ml-16">
                                        Summary not found in logs.
                                      </p>
                                  )}
                                </div>
                            ))}
                          </div>
                      ) : (
                          <p className="text-gray-400 text-sm">No Trivy scan runs found or workflow not configured.</p>
                      )}
                    </div>
                    {data?.error && (
                        <div className="mt-4 text-red-400 text-sm">
                          Error: {data.error}
                        </div>
                    )}
                  </div>
              );
            })}
          </div>
        </div>
      </div>
  );
}

export default App;
