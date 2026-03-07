/**
 * Jenkinsfile — Declarative CI/CD Pipeline
 *
 * All sensitive values stored in Jenkins Credentials — nothing hardcoded.
 *
 * Required Jenkins Credentials:
 *   Secret text  — DOCKERHUB_REPO     e.g. youruser/nodejs-product-catalog
 *   User/pass    — dockerhub-creds    Docker Hub username + access token
 *   User/pass    — github-token       GitHub username + PAT
 */

pipeline {
    // Run directly on Jenkins agent — not inside a Docker container
    // This avoids the "docker not found" error when Jenkins itself is in Docker
    agent any

    environment {
        DOCKERHUB_REPO = credentials('DOCKERHUB_REPO')
        IMAGE_TAG      = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
        timestamps()
    }

    stages {

        // ── Stage 1: Checkout ───────────────────────────────────────────────
        stage('Checkout') {
            steps {
                echo "==> Checking out branch: ${env.BRANCH_NAME}"
                checkout scm
                sh 'git log --oneline -5'
            }
        }

        // ── Stage 2: Install Dependencies ──────────────────────────────────
        stage('Install') {
            steps {
                dir('app') {
                    echo '==> Installing npm dependencies'
                    sh 'npm install'
                }
            }
        }

        // ── Stage 3: Test ───────────────────────────────────────────────────
        stage('Test') {
            steps {
                dir('app') {
                    echo '==> Running Jest tests'
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
        stage('Docker Build') {
            steps {
                dir('app') {
                    echo "==> Building Docker image"
                    sh """
                        docker build \
                            --tag ${DOCKERHUB_REPO}:${IMAGE_TAG} \
                            --tag ${DOCKERHUB_REPO}:latest \
                            .
                    """
                }
            }
        }

        // ── Stage 5: Push to Docker Hub ─────────────────────────────────────
        stage('Push to Docker Hub') {
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

                        docker push ${DOCKERHUB_REPO}:${IMAGE_TAG}
                        docker push ${DOCKERHUB_REPO}:latest

                        docker logout
                    """
                }
            }
        }

    } // end stages

    post {
        success {
            echo "✅ Pipeline SUCCESS — image pushed to Docker Hub"
        }
        failure {
            echo '❌ Pipeline FAILED — check the logs above'
        }
        always {
            // Use withCredentials here so DOCKERHUB_REPO is available in post block
            withCredentials([string(credentialsId: 'DOCKERHUB_REPO', variable: 'REPO')]) {
                sh """
                    docker rmi ${REPO}:${IMAGE_TAG} || true
                    docker rmi ${REPO}:latest || true
                """
            }
        }
    }

} // end pipeline