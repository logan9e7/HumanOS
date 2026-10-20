"""Reproducible CPU-only GoEmotions baseline; never trains on private users."""
import argparse,csv,json,hashlib
from pathlib import Path
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.metrics import f1_score, precision_score, recall_score

def read(path,n):
 texts=[];ys=[]
 with open(path,encoding='utf8') as f:
  for row in csv.reader(f,delimiter='\t'):
   if len(row)!=3: continue
   y=np.zeros(n,dtype=np.int8)
   for i in row[1].split(','):y[int(i)]=1
   texts.append(row[0]);ys.append(y)
 return texts,np.array(ys)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--data',default='/workspace/scratch/53979e5904c3');ap.add_argument('--output',default='ai/models');a=ap.parse_args();p=Path(a.data);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
 labels=(p/'goemotions-emotions.txt').read_text().splitlines();train,y=read(p/'goemotions-train.tsv',len(labels));dev,yd=read(p/'goemotions-dev.tsv',len(labels));test,yt=read(p/'goemotions-test.tsv',len(labels))
 vector=TfidfVectorizer(max_features=7000,ngram_range=(1,2),sublinear_tf=True,strip_accents=None,token_pattern=r'(?u)\b[a-z0-9_]{2,}\b',dtype=np.float64)
 x=vector.fit_transform(train);clf=OneVsRestClassifier(LogisticRegression(C=4,solver='liblinear',max_iter=300,random_state=42),n_jobs=1);clf.fit(x,y)
 pd=clf.predict_proba(vector.transform(dev));thresholds=[]
 for i in range(len(labels)):
  candidates=np.arange(.2,.71,.05);best=max(candidates,key=lambda t:f1_score(yd[:,i],pd[:,i]>=t,zero_division=0));thresholds.append(round(float(best),2))
 probs=clf.predict_proba(vector.transform(test));pred=probs>=np.array(thresholds)
 weights=np.array([e.coef_[0] for e in clf.estimators_]);terms=vector.get_feature_names_out()
 model={'version':'goemotions-tfidf-logreg-v1','labels':labels,'terms':terms.tolist(),'idf':np.round(vector.idf_,6).tolist(),'weights':np.round(weights,5).tolist(),'bias':np.round([e.intercept_[0] for e in clf.estimators_],6).tolist(),'thresholds':thresholds}
 (out/'emotion-model.json').write_text(json.dumps(model,separators=(',',':')))
 card={'version':model['version'],'algorithm':'TF-IDF unigrams/bigrams + one-vs-rest logistic regression','features':len(terms),'labels':len(labels),'train_examples':len(train),'dev_examples':len(dev),'test_examples':len(test),'seed':42,'micro_f1':round(f1_score(yt,pred,average='micro'),4),'macro_f1':round(f1_score(yt,pred,average='macro'),4),'micro_precision':round(precision_score(yt,pred,average='micro',zero_division=0),4),'micro_recall':round(recall_score(yt,pred,average='micro',zero_division=0),4),'source':'https://github.com/google-research/google-research/tree/master/goemotions','paper':'https://aclanthology.org/2020.acl-main.372/','license':'Apache-2.0 (Google Research source/data distribution); Reddit-origin text','limitations':['English Reddit comments differ from private conversation.','Scores are not calibrated probabilities or clinical measurements.','Does not infer hormone levels, diagnoses or validated personality scores.','No private user data enters training.'],'model_sha256':hashlib.sha256((out/'emotion-model.json').read_bytes()).hexdigest()}
 (out/'model-card.json').write_text(json.dumps(card,indent=2));print(json.dumps(card,indent=2))
 # Cross-runtime parity fixture contains only invented text, not dataset excerpts.
 texts=['I feel nervous about tomorrow but excited to see my friends.','I am sad and I miss those evenings.','The train arrives at six.'];probs=clf.predict_proba(vector.transform(texts));(out/'parity-fixtures.json').write_text(json.dumps([{'text':t,'scores':dict(zip(labels,[round(float(v),6) for v in ps]))}for t,ps in zip(texts,probs)],indent=2))
