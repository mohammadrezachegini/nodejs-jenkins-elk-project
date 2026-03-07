/**
 * Jenkinsfile — Declarative CI/CD Pipeline
 *
 * All sensitive values are stored in Jenkins Credentials — nothing
 * hardcoded in this file. This file is safe to commit to a public repo.
 *
 * Required Jenkins Credentials:
 *   Secret text     — DOCKERHUB_REPO      e.g. youruser/nodejs-product-catalog
 *   Secret text     — GIT_REPO_URL        e.g. https://github.com/youruser/repo.git
 *   User/pass       — dockerhub-creds     Docker Hub username + access token
 *   User/pass       — github-token        GitHub username + PAT
 */

pipeline {
    agent {
        docker {
            image 'node:20-alpine'
            args  '-v /var/run/docker.sock:/var/run/docker.sock -u root'
        }
    }

    environment {
        // Pull secret text values from Jenkins credential store
        DOCKERHUB_REPO = credentials('DOCKERHUB_REPO')
        GIT_REPO_URL   = credentials('GIT_REPO_URL')

        // Git SHA — used as the image tag for full traceability
        IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
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
                    sh 'npm ci --frozen-lockfile'
                }
            }
        }

        // ── Stage 3: Test ───────────────────────────────────────────────────
        stage('Test') {
            steps {
                dir('app') {
                    echo '==> Running Jest tests'
                    sh 'npm test -- --reporters=default --reporters=jest-junit'
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
                echo "==> Building Docker image: ${DOCKERHUB_REPO}:${IMAGE_TAG}"
                dir('app') {
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
            echo """
            ✅ Pipeline SUCCESS
            Image: ${DOCKERHUB_REPO}:${IMAGE_TAG}
            ArgoCD will deploy this tag to the cluster.
            """
        }
        failure {
            echo '❌ Pipeline FAILED — check the logs above'
        }
        always {
            sh """
                docker rmi ${DOCKERHUB_REPO}:${IMAGE_TAG} || true
                docker rmi ${DOCKERHUB_REPO}:latest || true
            """
        }
    }

} // end pipeline