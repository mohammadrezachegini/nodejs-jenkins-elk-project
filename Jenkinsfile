/**
 * Jenkinsfile — Declarative CI/CD Pipeline
 *
 * agent any — runs on Jenkins host (Ubuntu)
 * npm stages run inside node:20-alpine container via docker run
 * docker build/push run directly on host
 *
 * Required Jenkins Credentials:
 *   Secret text  — DOCKERHUB_REPO     e.g. youruser/nodejs-product-catalog
 *   Secret text  — GIT_REPO_URL       e.g. https://github.com/youruser/repo.git
 *   User/pass    — dockerhub-creds    Docker Hub username + access token
 *   User/pass    — github-token       GitHub username + PAT
 */

pipeline {
    agent any

    environment {
        DOCKERHUB_REPO = credentials('DOCKERHUB_REPO')
        GIT_REPO_URL   = credentials('GIT_REPO_URL')
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
        // Runs on host — git is available on Ubuntu Jenkins
        stage('Checkout') {
            steps {
                echo "==> Commit: ${env.IMAGE_TAG}"
                sh 'git log --oneline -5'
            }
        }

        // ── Stage 2: Install ────────────────────────────────────────────────
        // docker run mounts workspace into node:20-alpine container
        // --rm removes container after command finishes
        stage('Install') {
            steps {
                echo '==> Installing npm dependencies'
                sh """
                    docker run --rm \
                        -v ${WORKSPACE}/app:/app \
                        -w /app \
                        node:20-alpine \
                        npm ci --frozen-lockfile
                """
            }
        }

        // ── Stage 3: Test ───────────────────────────────────────────────────
        stage('Test') {
            steps {
                echo '==> Running Jest tests'
                sh """
                    docker run --rm \
                        -v ${WORKSPACE}/app:/app \
                        -w /app \
                        node:20-alpine \
                        npm test
                """
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
                echo "==> Building image: ${DOCKERHUB_REPO}:${IMAGE_TAG}"
                sh """
                    docker build \
                        --tag ${DOCKERHUB_REPO}:${IMAGE_TAG} \
                        --tag ${DOCKERHUB_REPO}:latest \
                        app/
                """
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

        // ── Stage 6: Update Helm values.yaml ────────────────────────────────
        stage('Update Helm Chart') {
            steps {
                sh """
                    sed -i 's|tag: .*|tag: "${IMAGE_TAG}"|' helm/nodejs-app/values.yaml
                    sed -i 's|tag: .*|tag: "${IMAGE_TAG}"|' helm/nodejs-app/values-prod.yaml
                    echo '==> Updated image tag to: ${IMAGE_TAG}'
                    grep 'tag:' helm/nodejs-app/values.yaml
                """
            }
        }

        // ── Stage 7: Push to Git ─────────────────────────────────────────────
        stage('Push to Git') {
            when {
                branch 'master'
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

                        git diff --staged --quiet || git commit -m "ci: update image tag to ${IMAGE_TAG} [skip ci]"

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
            echo "✅ Pipeline SUCCESS — ${DOCKERHUB_REPO}:${IMAGE_TAG}"
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