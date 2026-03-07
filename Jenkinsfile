/**
 * Jenkinsfile — Declarative CI/CD Pipeline
 *
 * Uses per-stage Docker agents:
 *   - node:20-alpine  for Install + Test stages
 *   - docker:24-cli   for Docker Build + Push stages
 *   - alpine/git      for Git push stage
 *
 * No custom image needed — each stage pulls a standard public image.
 *
 * Required Jenkins Credentials:
 *   Secret text  — DOCKERHUB_REPO     e.g. youruser/nodejs-product-catalog
 *   Secret text  — GIT_REPO_URL       e.g. https://github.com/youruser/repo.git
 *   User/pass    — dockerhub-creds    Docker Hub username + access token
 *   User/pass    — github-token       GitHub username + PAT
 */

pipeline {
    // No global agent — each stage defines its own Docker container
    agent none

    environment {
        DOCKERHUB_REPO = credentials('DOCKERHUB_REPO')
        GIT_REPO_URL   = credentials('GIT_REPO_URL')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
        timestamps()
    }

    stages {

        // ── Stage 1: Checkout ───────────────────────────────────────────────
        // Just prints commit info — runs in node image since it's lightweight
        stage('Checkout') {
            agent {
                docker {
                    image 'node:20-alpine'
                    args '-v /var/run/docker.sock:/var/run/docker.sock'
                }
            }
            steps {
                echo "==> Checking out branch: ${env.BRANCH_NAME}"
                checkout scm
                sh 'git log --oneline -5'
            }
        }

        // ── Stage 2: Install Dependencies ──────────────────────────────────
        stage('Install') {
            agent {
                docker { image 'node:20-alpine' }
            }
            steps {
                dir('app') {
                    echo '==> Installing npm dependencies'
                    sh 'npm ci --frozen-lockfile'
                }
            }
        }

        // ── Stage 3: Test ───────────────────────────────────────────────────
        stage('Test') {
            agent {
                docker { image 'node:20-alpine' }
            }
            steps {
                dir('app') {
                    echo '==> Running Jest tests'
                    sh 'npm ci --frozen-lockfile'
                    sh 'npm test'
                }
            }
            post {
                always {
                    junit allowEmptyResults: true,
                          testResults: 'app/junit.xml'
                }
            }
        }

        // ── Stage 4: Docker Build ───────────────────────────────────────────
        // docker:24-cli has Docker CLI but not Node — perfect for build/push
        stage('Docker Build') {
            agent {
                docker {
                    image 'docker:24-cli'
                    // Mount Docker socket so this container can talk to host Docker daemon
                    args '-v /var/run/docker.sock:/var/run/docker.sock'
                }
            }
            steps {
                // Capture Git SHA here since we are in the workspace
                script {
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                }
                echo "==> Building Docker image: ${DOCKERHUB_REPO}:${env.IMAGE_TAG}"
                dir('app') {
                    sh """
                        docker build \
                            --tag ${DOCKERHUB_REPO}:${env.IMAGE_TAG} \
                            --tag ${DOCKERHUB_REPO}:latest \
                            .
                    """
                }
            }
        }

        // ── Stage 5: Push to Docker Hub ─────────────────────────────────────
        stage('Push to Docker Hub') {
            agent {
                docker {
                    image 'docker:24-cli'
                    args '-v /var/run/docker.sock:/var/run/docker.sock'
                }
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub-creds',
                        usernameVariable: 'DH_USER',
                        passwordVariable: 'DH_TOKEN'
                    )
                ]) {
                    sh """
                        echo "${DH_TOKEN}" | docker login \
                            --username ${DH_USER} \
                            --password-stdin

                        docker push ${DOCKERHUB_REPO}:${env.IMAGE_TAG}
                        docker push ${DOCKERHUB_REPO}:latest

                        docker logout
                    """
                }
            }
        }

        // ── Stage 6: Update Helm values.yaml ────────────────────────────────
        // alpine has sed built in — lightweight for file editing
        stage('Update Helm Chart') {
            agent {
                docker { image 'alpine:3.19' }
            }
            steps {
                dir('helm/nodejs-app') {
                    sh """
                        sed -i 's|tag: .*|tag: "${env.IMAGE_TAG}"|' values.yaml
                        sed -i 's|tag: .*|tag: "${env.IMAGE_TAG}"|' values-prod.yaml
                        echo '==> Updated image tag to: ${env.IMAGE_TAG}'
                        grep 'tag:' values.yaml
                    """
                }
            }
        }

        // ── Stage 7: Push Updated values.yaml to Git ────────────────────────
        stage('Push to Git') {
            when {
                branch 'master'
            }
            agent {
                docker { image 'alpine/git:latest' }
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'github-token',
                        usernameVariable: 'GIT_USER',
                        passwordVariable: 'GIT_TOKEN'
                    )
                ]) {
                    sh """
                        git config user.email "jenkins@ci.local"
                        git config user.name "Jenkins CI"

                        git add helm/nodejs-app/values.yaml
                        git add helm/nodejs-app/values-prod.yaml

                        git commit -m "ci: update image tag to ${env.IMAGE_TAG} [skip ci]"

                        REPO_URL_NO_SCHEME=\$(echo "${GIT_REPO_URL}" | sed 's|https://||')
                        git push https://${GIT_USER}:${GIT_TOKEN}@\${REPO_URL_NO_SCHEME} HEAD:master
                    """
                }
                echo '==> ArgoCD will detect the change and sync the deployment'
            }
        }

    } // end stages

    post {
        success {
            echo "✅ Pipeline SUCCESS — Image: ${DOCKERHUB_REPO}:${env.IMAGE_TAG}"
        }
        failure {
            echo '❌ Pipeline FAILED — check the logs above'
        }
    }

} // end pipeline